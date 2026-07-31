import type { PdfEngine } from "@embedpdf/models";

import { PDFIUM_WASM_URL } from "@/client/lib/document-viewers";
import { cn } from "@/client/lib/utils";
import { createPluginRegistration } from "@embedpdf/core";
import { EmbedPDF } from "@embedpdf/core/react";
import {
  DocumentManagerPluginPackage,
  useActiveDocument,
  useDocumentManagerCapability,
} from "@embedpdf/plugin-document-manager/react";
import {
  GlobalPointerProvider,
  InteractionManagerPluginPackage,
  PagePointerProvider,
} from "@embedpdf/plugin-interaction-manager/react";
import { RenderLayer, RenderPluginPackage } from "@embedpdf/plugin-render/react";
import {
  type PageLayout,
  Scroller,
  ScrollPluginPackage,
  useScroll,
} from "@embedpdf/plugin-scroll/react";
import {
  SearchLayer,
  SearchPluginPackage,
  useSearch,
} from "@embedpdf/plugin-search/react";
import {
  CopyToClipboard,
  SelectionLayer,
  SelectionPluginPackage,
  useSelectionCapability,
} from "@embedpdf/plugin-selection/react";
import {
  ThumbImg,
  type ThumbMeta,
  ThumbnailPluginPackage,
  ThumbnailsPane,
} from "@embedpdf/plugin-thumbnail/react";
import { TilingLayer, TilingPluginPackage } from "@embedpdf/plugin-tiling/react";
import {
  Viewport,
  ViewportPluginPackage,
} from "@embedpdf/plugin-viewport/react";
import { useZoom, ZoomMode, ZoomPluginPackage } from "@embedpdf/plugin-zoom/react";
import { useEffect, useState } from "react";

import { ViewerBody, ViewerLoading } from "./viewer-surface";
import {
  ViewerFindControl,
  ViewerPageControl,
  ViewerRailToggle,
  ViewerToolbar,
  ViewerToolbarSpacer,
  ViewerZoomControl,
} from "./viewer-toolbar";
import { ZOOM_LEVELS } from "./zoom-levels";

const ignore = () => {
  // Nothing to do; see the call sites.
};

// Applied to the two bitmap layers so neither takes a pointer nor offers itself
// to the browser's drag machinery. `WebkitUserDrag` is the part Chromium
// actually honours for an `<img>`; `pointerEvents` keeps hit-testing on the
// wrapper that owns selection.
const NON_INTERACTIVE_LAYER = {
  pointerEvents: "none",
  WebkitUserDrag: "none",
} as const;

const PAGE_GAP = 16;
const THUMBNAIL_WIDTH = 104;
const THUMBNAIL_GAP = 10;
const THUMBNAIL_PADDING = 6;
const THUMBNAIL_LABEL_HEIGHT = 18;
// Debounced because `searchAllPages` walks the whole document, which is
// noticeable on a large PDF and would otherwise run on every keystroke.
const SEARCH_DEBOUNCE_MS = 250;

/**
 * The engine compiles pdfium and spawns its worker, so it is created once for
 * the renderer rather than per mounted viewer. Opening a second PDF reuses it.
 */
let enginePromise: null | Promise<PdfEngine> = null;

// Created once at module scope: the registrations are configuration, not state,
// and rebuilding them per mount would reset the plugin tree on every render.
const PLUGINS = [
  createPluginRegistration(DocumentManagerPluginPackage),
  createPluginRegistration(ViewportPluginPackage, { viewportGap: PAGE_GAP }),
  createPluginRegistration(ScrollPluginPackage, {
    defaultBufferSize: 2,
    defaultPageGap: PAGE_GAP,
  }),
  createPluginRegistration(RenderPluginPackage),
  // Tiles keep memory bounded at high zoom: only the visible region of a page
  // is rasterized, instead of one bitmap the size of the whole scaled page.
  createPluginRegistration(TilingPluginPackage, {
    extraRings: 0,
    overlapPx: 2.5,
    tileSize: 768,
  }),
  createPluginRegistration(InteractionManagerPluginPackage),
  createPluginRegistration(SelectionPluginPackage, {
    marquee: { enabled: false },
  }),
  createPluginRegistration(SearchPluginPackage, { showAllResults: true }),
  createPluginRegistration(ThumbnailPluginPackage, {
    autoScroll: true,
    buffer: 3,
    gap: THUMBNAIL_GAP,
    imagePadding: THUMBNAIL_PADDING,
    labelHeight: THUMBNAIL_LABEL_HEIGHT,
    paddingY: 12,
    scrollBehavior: "auto",
    width: THUMBNAIL_WIDTH,
  }),
  createPluginRegistration(ZoomPluginPackage, {
    defaultZoomLevel: ZoomMode.FitWidth,
    maxZoom: ZOOM_LEVELS.at(-1),
    minZoom: ZOOM_LEVELS[0],
  }),
];

export function PdfViewer({ url }: { filename: string; url: string }) {
  const [engine, setEngine] = useState<null | PdfEngine>(null);
  const [engineError, setEngineError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadEngine().then(
      (loaded) => {
        if (!cancelled) {
          setEngine(loaded);
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setEngineError(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Thrown rather than rendered so it reaches the surface's `CatchBoundary`,
  // which owns the "preview unavailable" card for every viewer.
  if (engineError) {
    throw engineError;
  }

  if (!engine) {
    return <ViewerLoading />;
  }

  return (
    <EmbedPDF engine={engine} plugins={PLUGINS}>
      <PdfDocument url={url} />
    </EmbedPDF>
  );
}

function loadEngine() {
  enginePromise ??= import("@embedpdf/engines/pdfium-worker-engine").then(
    ({ createPdfiumEngine }) => createPdfiumEngine(PDFIUM_WASM_URL, {}),
  );
  // A failed start is not kept: caching the rejection would leave every later
  // PDF showing the error card for the rest of the session, which defeats the
  // surface's recovery-on-next-file behavior.
  const pending = enginePromise;
  pending.catch(() => {
    if (enginePromise === pending) {
      enginePromise = null;
    }
  });
  return pending;
}

function PdfDocument({ url }: { url: string }) {
  const { provides: documentManager } = useDocumentManagerCapability();
  const { activeDocument, activeDocumentId } = useActiveDocument();
  // Keyed by URL rather than a boolean so opening a different file clears the
  // previous failure without a synchronous reset inside the effect.
  const [errorUrl, setErrorUrl] = useState<null | string>(null);
  const loadError = errorUrl === url;

  useEffect(() => {
    if (!documentManager) {
      return;
    }

    const previousIds = documentManager
      .getOpenDocuments()
      .map((document) => document.id);
    const handleError = () => {
      setErrorUrl(url);
    };
    let openedId: string | undefined;
    let unmounted = false;

    documentManager
      .openDocumentUrl({
        // "auto" streams the document with HTTP range requests, which the local
        // asset server supports. Blob URLs cannot be ranged.
        mode: url.startsWith("blob:") ? "full-fetch" : "auto",
        url,
      })
      .wait((response) => {
        response.task.wait((opened) => {
          openedId = opened.id;
          for (const id of previousIds) {
            // Best effort: a document that fails to close is already
            // unreachable, and surfacing it would replace a rendered PDF with
            // an error card.
            documentManager.closeDocument(id).wait(ignore, ignore);
          }
          if (unmounted) {
            documentManager.closeDocument(opened.id).wait(ignore, ignore);
          }
        }, handleError);
      }, handleError);

    // The engine is shared across the renderer's lifetime, so a document left
    // open after the panel closes holds its pdfium memory indefinitely.
    return () => {
      unmounted = true;
      if (openedId !== undefined) {
        documentManager.closeDocument(openedId).wait(ignore, ignore);
      }
    };
  }, [documentManager, url]);

  if (loadError || activeDocument?.status === "error") {
    throw new Error("This PDF could not be opened.");
  }

  if (!activeDocumentId || activeDocument?.status !== "loaded") {
    return <ViewerLoading />;
  }

  return <PdfDocumentView documentId={activeDocumentId} />;
}

function PdfDocumentView({ documentId }: { documentId: string }) {
  const [railOpen, setRailOpen] = useState(false);
  const { provides: scroll, state: scrollState } = useScroll(documentId);
  const { provides: zoom, state: zoomState } = useZoom(documentId);
  const { provides: search, state: searchState } = useSearch(documentId);
  const { provides: selection } = useSelectionCapability();
  const [query, setQuery] = useState("");

  // pdfium extracts real text and `SelectionLayer` tracks a selection over it,
  // but nothing in the library binds a copy shortcut, so a selection could be
  // made and never taken anywhere -- which reads as the page being a picture.
  //
  // Guarded on there being rects, for two reasons: `copyToClipboard` with an
  // empty selection emits an empty string and would wipe the clipboard on any
  // Cmd+C elsewhere in the app, and both the artifact panel and the expand
  // modal can have a viewer mounted at once, so whichever one holds the
  // selection should be the one that answers.
  useEffect(() => {
    if (!selection) {
      return;
    }
    const scope = selection.forDocument(documentId);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "c" || !(event.metaKey || event.ctrlKey)) {
        return;
      }
      if (scope.getBoundingRects().length === 0) {
        return;
      }
      event.preventDefault();
      scope.copyToClipboard();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [documentId, selection]);

  // The search session has to be open before results can be requested, and it
  // is torn down with the document so a reopened file starts clean.
  useEffect(() => {
    search?.startSearch();
    return () => {
      search?.stopSearch();
    };
  }, [search]);

  // Debounced because `searchAllPages` walks every page, which is noticeable
  // on a large document and would otherwise run on each keystroke. Restarting
  // the session on an emptied query is what clears the existing highlights.
  useEffect(() => {
    if (!search) {
      return;
    }
    if (query === "") {
      search.stopSearch();
      search.startSearch();
      return;
    }
    const timer = setTimeout(() => {
      search.searchAllPages(query);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [query, search]);

  return (
    <>
      <ViewerToolbar>
        <ViewerRailToggle
          onToggle={() => {
            setRailOpen((open) => !open);
          }}
          open={railOpen}
        />
        <ViewerPageControl
          count={scrollState.totalPages}
          onPageChange={(page) => {
            scroll?.scrollToPage({ pageNumber: page });
          }}
          page={scrollState.currentPage}
        />
        <ViewerZoomControl
          onFit={() => {
            zoom?.requestZoom(ZoomMode.FitWidth);
          }}
          onZoomChange={(level) => {
            zoom?.requestZoom(level);
          }}
          zoom={zoomState.currentZoomLevel}
        />
        <ViewerToolbarSpacer />
        <ViewerFindControl
          activeMatch={searchState.activeResultIndex}
          matchCount={searchState.total}
          onNextMatch={() => {
            search?.nextResult();
          }}
          onPreviousMatch={() => {
            search?.previousResult();
          }}
          onQueryChange={setQuery}
          query={query}
        />
      </ViewerToolbar>

      <ViewerBody
        rail={<PdfThumbnailRail documentId={documentId} />}
        railOpen={railOpen}
      >
        {/* Turns a selection into a real clipboard write on Cmd/Ctrl+C. */}
        <CopyToClipboard />
        <GlobalPointerProvider documentId={documentId}>
          <Viewport
            className="absolute inset-0 bg-muted/40"
            documentId={documentId}
          >
            <Scroller
              documentId={documentId}
              renderPage={(page) => (
                <PdfPage documentId={documentId} page={page} />
              )}
            />
          </Viewport>
        </GlobalPointerProvider>
      </ViewerBody>
    </>
  );
}

function PdfPage({
  documentId,
  page,
}: {
  documentId: string;
  page: PageLayout;
}) {
  return (
    <div
      className="bg-white shadow-sm"
      style={{ height: page.height, width: page.width }}
    >
      <PagePointerProvider
        documentId={documentId}
        pageIndex={page.pageIndex}
        style={{ height: page.height, position: "relative", width: page.width }}
      >
        {/* A full-page bitmap paints first, then tiles refine the visible
            region; both are needed or high zoom shows blank until tiles land.

            Both render an `<img>`, which the browser makes draggable. Left
            alone, a drag starting anywhere but exactly on a glyph tears the
            page bitmap out as a drag image rather than selecting text, so
            selection looks broken to anyone who misses on the first attempt.
            Neither layer needs to see a pointer: selection is driven by the
            pointer provider wrapping them. */}
        <RenderLayer
          documentId={documentId}
          pageIndex={page.pageIndex}
          style={NON_INTERACTIVE_LAYER}
        />
        <TilingLayer
          documentId={documentId}
          pageIndex={page.pageIndex}
          style={NON_INTERACTIVE_LAYER}
        />
        <SearchLayer documentId={documentId} pageIndex={page.pageIndex} />
        <SelectionLayer documentId={documentId} pageIndex={page.pageIndex} />
      </PagePointerProvider>
    </div>
  );
}

function PdfThumbnailRail({ documentId }: { documentId: string }) {
  const { provides: scroll, state } = useScroll(documentId);

  return (
    <ThumbnailsPane className="h-full" documentId={documentId}>
      {(meta: ThumbMeta) => (
        <button
          className={cn(
            "absolute left-1/2 flex -translate-x-1/2 flex-col items-center gap-1 rounded-md p-1",
            state.currentPage === meta.pageIndex + 1
              ? "bg-accent"
              : "hover:bg-muted",
          )}
          key={meta.pageIndex}
          onClick={() => {
            scroll?.scrollToPage({ pageNumber: meta.pageIndex + 1 });
          }}
          style={{ height: meta.wrapperHeight, top: meta.top }}
          type="button"
        >
          <ThumbImg
            className="rounded-xs bg-white shadow-sm"
            documentId={documentId}
            meta={meta}
          />
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {meta.pageIndex + 1}
          </span>
        </button>
      )}
    </ThumbnailsPane>
  );
}

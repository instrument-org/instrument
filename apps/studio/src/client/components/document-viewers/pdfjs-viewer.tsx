import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

import { PDFJS_ASSET_URLS } from "@/client/lib/document-viewers";
import { cn } from "@/client/lib/utils";
import { MAX_ZOOM, MIN_ZOOM } from "@/client/lib/zoom-levels";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import {
  EventBus,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import { useEffect, useRef, useState } from "react";
import "pdfjs-dist/web/pdf_viewer.css";

import { ViewerBody, ViewerLoading } from "./viewer-surface";
import {
  ViewerFindControl,
  ViewerPageControl,
  ViewerRailToggle,
  ViewerToolbar,
  ViewerToolbarSpacer,
  ViewerZoomControl,
} from "./viewer-toolbar";

// pdf.js's own value for fit-to-width, re-applied by the viewer whenever the
// container changes size.
const FIT_WIDTH = "page-width";
const THUMBNAIL_WIDTH = 104;
const SEARCH_DEBOUNCE_MS = 250;
// The hook pdf.js's own stylesheet hangs every page and text-layer rule on.
const PDF_VIEWER_CLASS = "pdfViewer";

// `current` is one-based and zero when nothing is selected.
interface MatchCount { current: number; total: number }

/**
 * The worker ships as a file rather than a module the renderer can import, and
 * in production it lives on the app protocol, which is cross-origin to the
 * renderer: `new Worker` refuses that outright. Fetching it and handing over a
 * blob of the same bytes is what the CSP's `worker-src blob:` is there for.
 */
let workerPromise: null | Promise<void> = null;

/**
 * A PDF rendered by pdf.js rather than pdfium.
 *
 * The reason for a second renderer is text. pdf.js paints each page to a canvas
 * and then lays real, transparent, positioned text over it, so a selection is
 * an ordinary DOM selection: the native menu offers Copy and Look Up, Cmd+C
 * needs no interception, and a right-click leaves the highlight alone. The
 * pdfium viewer keeps its selection inside the engine and can do none of that.
 *
 * What it costs is a page of imperative setup, because pdf.js's viewer
 * component owns its own DOM and scrolling and speaks through an event bus
 * rather than props.
 */
export function PdfJsViewer({ url }: { filename: string; url: string }) {
  const [railOpen, setRailOpen] = useState(false);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [viewerElement, setViewerElement] = useState<HTMLDivElement | null>(
    null,
  );
  // The viewer is an imperative object driven through setters, so it lives in
  // a ref: nothing renders from it, and holding it in state would mean
  // mutating a state value on every zoom and page change.
  const viewerRef = useRef<null | PDFViewer>(null);
  // Created once and reused across documents, so the effects below can talk to
  // it before the viewer exists and without a state update to announce it.
  const [eventBus] = useState(() => new EventBus());
  const [pdfDocument, setPdfDocument] = useState<null | PDFDocumentProxy>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [isFit, setIsFit] = useState(true);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState({ current: 0, total: 0 });
  const [loadError, setLoadError] = useState<Error | null>(null);

  useEffect(() => {
    if (!container || !viewerElement) {
      return;
    }

    const linkService = new PDFLinkService({ eventBus });
    const findController = new PDFFindController({
      eventBus,
      linkService,
      updateMatchesCountOnProgress: true,
    });
    const pdfViewer = new PDFViewer({
      container,
      eventBus,
      findController,
      linkService,
      viewer: viewerElement,
    });
    linkService.setViewer(pdfViewer);
    viewerRef.current = pdfViewer;

    // Opening at fit-width has to wait for the first page's size, and the
    // readout follows every scale change so a pinch or a preset both land in
    // the toolbar.
    const listeners = new AbortController();
    const options = { signal: listeners.signal };
    eventBus.on(
      "pagesinit",
      () => {
        pdfViewer.currentScaleValue = FIT_WIDTH;
      },
      options,
    );
    eventBus.on(
      "pagechanging",
      ({ pageNumber }: { pageNumber: number }) => {
        setPage(pageNumber);
      },
      options,
    );
    eventBus.on(
      "scalechanging",
      ({ presetValue, scale }: { presetValue?: string; scale: number }) => {
        setZoom(scale);
        setIsFit(presetValue === FIT_WIDTH);
      },
      options,
    );
    for (const event of ["updatefindmatchescount", "updatefindcontrolstate"]) {
      eventBus.on(
        event,
        ({ matchesCount }: { matchesCount: MatchCount }) => {
          setMatches(matchesCount);
        },
        options,
      );
    }

    let cancelled = false;
    const loadingTask = loadWorker().then(() =>
      getDocument({
        cMapUrl: PDFJS_ASSET_URLS.cMapUrl,
        iccUrl: PDFJS_ASSET_URLS.iccUrl,
        standardFontDataUrl: PDFJS_ASSET_URLS.standardFontDataUrl,
        url,
        wasmUrl: PDFJS_ASSET_URLS.wasmUrl,
      }),
    );

    void loadingTask.then(
      async (task) => {
        const loaded = await task.promise;
        if (cancelled) {
          return;
        }
        pdfViewer.setDocument(loaded);
        linkService.setDocument(loaded);
        setPdfDocument(loaded);
      },
      (error: unknown) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      },
    );

    return () => {
      cancelled = true;
      listeners.abort();
      viewerRef.current = null;
      // Drops the page views and aborts the listeners the viewer put on the
      // container. The tidier route would be `setDocument(null)`, which the
      // implementation handles and routes here, but its published type admits
      // a document only. Destroying the loading task then ends the worker
      // session and rejects whatever was still rendering.
      pdfViewer._resetView();
      void loadingTask.then((task) => task.destroy());
    };
  }, [container, eventBus, url, viewerElement]);

  // Fit-width is a mode, not a one-off: the artifact panel is resizable, so a
  // scale computed once is stale before the drag ends. pdf.js re-derives it
  // from the container whenever the preset is re-applied.
  useEffect(() => {
    if (!container || !isFit) {
      return;
    }
    let frame = 0;
    const observer = new ResizeObserver(() => {
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        if (viewerRef.current) {
          viewerRef.current.currentScaleValue = FIT_WIDTH;
        }
      });
    });
    observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [container, isFit]);

  // Debounced because each search walks the document's text; restarting on an
  // emptied query is what clears the existing highlights.
  useEffect(() => {
    const timer = setTimeout(() => {
      eventBus.dispatch("find", {
        caseSensitive: false,
        entireWord: false,
        findPrevious: false,
        highlightAll: true,
        query,
        source: null,
        type: "",
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [eventBus, query]);

  const findAgain = (findPrevious: boolean) => {
    eventBus.dispatch("find", {
      caseSensitive: false,
      entireWord: false,
      findPrevious,
      highlightAll: true,
      query,
      source: null,
      type: "again",
    });
  };

  const goToPage = (nextPage: number) => {
    if (viewerRef.current) {
      viewerRef.current.currentPageNumber = nextPage;
    }
  };

  // Thrown rather than rendered so it reaches the surface's `CatchBoundary`,
  // which owns the "preview unavailable" card for every viewer.
  if (loadError) {
    throw loadError;
  }

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
          count={pdfDocument?.numPages ?? 0}
          onPageChange={goToPage}
          page={page}
        />
        <ViewerZoomControl
          isFit={isFit}
          onFit={() => {
            if (viewerRef.current) {
              viewerRef.current.currentScaleValue = FIT_WIDTH;
            }
          }}
          onZoomChange={(level) => {
            if (viewerRef.current) {
              viewerRef.current.currentScale = Math.min(
                Math.max(level, MIN_ZOOM),
                MAX_ZOOM,
              );
            }
          }}
          zoom={zoom}
        />
        <ViewerToolbarSpacer />
        <ViewerFindControl
          activeMatch={matches.current - 1}
          matchCount={matches.total}
          onNextMatch={() => {
            findAgain(false);
          }}
          onPreviousMatch={() => {
            findAgain(true);
          }}
          onQueryChange={setQuery}
          query={query}
        />
      </ViewerToolbar>

      <ViewerBody
        rail={
          pdfDocument && (
            <PdfJsThumbnailRail
              currentPage={page}
              onSelectPage={goToPage}
              pdfDocument={pdfDocument}
            />
          )
        }
        railOpen={railOpen}
      >
        {/* pdf.js insists on an absolutely positioned scroll container, and
            owns everything inside `.pdfViewer` itself. */}
        <div
          className="absolute inset-0 overflow-auto bg-muted/40"
          ref={setContainer}
        >
          <div className={PDF_VIEWER_CLASS} ref={setViewerElement} />
        </div>
        {!pdfDocument && <ViewerLoading />}
      </ViewerBody>
    </>
  );
}

function loadWorker() {
  workerPromise ??= fetch(PDFJS_ASSET_URLS.workerUrl)
    .then((response) => {
      // `fetch` resolves for a 404, and pdf.js answers a worker it cannot
      // start by falling back to running the parser on the main thread --
      // which it does by importing a blob, which the CSP then blocks, three
      // errors deep from a missing file. Fail here where it still reads as
      // one.
      if (!response.ok) {
        throw new Error(
          `The PDF worker could not be loaded (${response.status}).`,
        );
      }
      return response.blob();
    })
    .then((blob) => {
      GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
    });
  // A failed start is not kept: caching the rejection would leave every later
  // PDF showing the error card for the rest of the session, which defeats the
  // surface's recovery-on-next-file behavior.
  const pending = workerPromise;
  pending.catch(() => {
    if (workerPromise === pending) {
      workerPromise = null;
    }
  });
  return pending;
}

function PdfJsThumbnail({
  pageNumber,
  pdfDocument,
}: {
  pageNumber: number;
  pdfDocument: PDFDocumentProxy;
}) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!canvas) {
      return;
    }
    let render: RenderTask | undefined;
    let cancelled = false;

    void pdfDocument.getPage(pageNumber).then((loaded) => {
      if (cancelled) {
        return;
      }
      const unscaled = loaded.getViewport({ scale: 1 });
      const viewport = loaded.getViewport({
        scale: (THUMBNAIL_WIDTH * devicePixelRatio) / unscaled.width,
      });
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      const context = canvas.getContext("2d");
      if (!context) {
        return;
      }
      render = loaded.render({ canvas, canvasContext: context, viewport });
      render.promise.catch(() => {
        // A cancelled render rejects, which is how a thumbnail whose rail
        // closed before it finished is expected to end.
      });
    });

    return () => {
      cancelled = true;
      render?.cancel();
    };
  }, [canvas, pageNumber, pdfDocument]);

  return (
    <canvas
      className="rounded-xs bg-white shadow-sm"
      ref={setCanvas}
      style={{ width: THUMBNAIL_WIDTH }}
    />
  );
}

/**
 * Thumbnails, rendered here rather than taken from pdf.js: its own thumbnail
 * viewer is not part of the published component bundle.
 */
function PdfJsThumbnailRail({
  currentPage,
  onSelectPage,
  pdfDocument,
}: {
  currentPage: number;
  onSelectPage: (page: number) => void;
  pdfDocument: PDFDocumentProxy;
}) {
  return (
    <div className="flex flex-col items-center gap-1 py-3">
      {Array.from({ length: pdfDocument.numPages }, (_, index) => (
        <button
          className={cn(
            "flex flex-col items-center gap-1 rounded-md p-1",
            currentPage === index + 1 ? "bg-accent" : "hover:bg-muted",
          )}
          key={index}
          onClick={() => {
            onSelectPage(index + 1);
          }}
          type="button"
        >
          <PdfJsThumbnail pageNumber={index + 1} pdfDocument={pdfDocument} />
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {index + 1}
          </span>
        </button>
      ))}
    </div>
  );
}

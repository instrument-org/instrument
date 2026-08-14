import { cn } from "@/client/lib/utils";
import {
  DocxEditorViewer,
  type DocxPageLayoutInfo,
  useDocxEditor,
  useDocxPageLayout,
  useDocxViewerThumbnails,
} from "@extend-ai/react-docx";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { FileLoading } from "../file-loading";
import { useFitWidth } from "./use-fit-width";
import { useVisiblePage } from "./use-visible-page";
import { ViewerBody } from "./viewer-surface";
import {
  ViewerPageControl,
  ViewerRailToggle,
  ViewerToolbar,
  ViewerToolbarSpacer,
  ViewerZoomControl,
} from "./viewer-toolbar";

const THUMBNAIL_WIDTH = 104;
// How long `revealPage` waits for the viewer to mount the page it jumped to.
const REVEAL_CORRECTION_FRAMES = 10;

/**
 * DOCX rendering goes through the library's editor controller in `read-only`
 * mode rather than its lightweight `ReactDocxViewer`. Only the editor path
 * paginates and virtualizes, which is what makes a long document usable.
 *
 * There is no find control here: `@extend-ai/react-docx` exposes no search API
 * and the viewer virtualizes pages, so the browser's own find cannot see
 * offscreen content either. Tracked in the plan as its own follow-up.
 */
export function DocxViewer({
  filename,
  url,
}: {
  filename: string;
  url: string;
}) {
  const editor = useDocxEditor({ initialFileName: filename });
  const [railOpen, setRailOpen] = useState(false);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(
    null,
  );
  // The editor controller's own `currentPage` tracks the caret, which in
  // read-only mode never moves off whatever the paginator touched last -- a
  // freshly opened document reports its final page. Reading the scroll position
  // against the rendered page wrappers is what answers "what am I looking at".
  const currentPage = useVisiblePage({
    pageIndexAttribute: "data-docx-page-index",
    scrollElement,
  });
  const { layout } = useDocxPageLayout(editor);
  // Fitted by default: a Word page is 8.5in of content, which overflows the
  // artifact panel at any usual panel width, so opening at 100% means opening
  // on a horizontal scrollbar.
  const { fit, isFit, selectZoom, zoom } = useFitWidth({
    container: scrollElement,
    contentWidth: layout.pageWidthPx,
    initialFit: true,
  });

  const { data: file, error } = useQuery({
    queryFn: async () => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load file: ${response.statusText}`);
      }
      // The importer takes a `File`, not bytes, and uses the name for its own
      // display state.
      return new File([await response.blob()], filename);
    },
    queryKey: ["docx-file", url],
    retry: false,
  });

  const importRef = useRef<null | string>(null);
  useEffect(() => {
    if (!file || importRef.current === url) {
      return;
    }
    importRef.current = url;
    void editor.importDocxFile(file);
  }, [editor, file, url]);

  // The document renders in its own colors at every app theme, matching the PDF
  // viewer. The library offers a night-reader mode that inverts content, but
  // applying it here would make DOCX the only format whose pages change color
  // with the app, and its inverted body text reads washed out against the
  // shell. The surrounding chrome still follows the app theme.
  useEffect(() => {
    editor.setDocumentTheme("light");
  }, [editor]);

  // Thrown rather than rendered so it reaches the surface's `CatchBoundary`.
  if (error) {
    throw error;
  }
  if (editor.importError) {
    throw editor.importError;
  }

  const isLoading = !file || editor.isImporting;

  return (
    <>
      <ViewerToolbar>
        <ViewerRailToggle
          onToggle={() => {
            setRailOpen((open) => !open);
          }}
          open={railOpen}
        />
        {/* Only once a document has been imported. The editor starts on an empty
            one, which is a page of nothing reported as page 1 of 1, and a
            document opened over another one shows that for as long as the
            import takes. The nonce counts documents loaded rather than tracking
            the import itself, so it stays raised while a save re-imports the
            open document and the controls it is not changing stay put. */}
        {editor.documentLoadNonce > 0 && (
          <>
            <ViewerPageControl
              count={Math.max(editor.totalPages, 1)}
              onPageChange={(page) => {
                revealPage({
                  layout,
                  pageIndex: page - 1,
                  scrollElement,
                  zoom,
                });
              }}
              page={Math.min(currentPage, Math.max(editor.totalPages, 1))}
            />
            <ViewerZoomControl
              isFit={isFit}
              onFit={fit}
              onZoomChange={selectZoom}
              zoom={zoom}
            />
          </>
        )}
        <ViewerToolbarSpacer />
      </ViewerToolbar>

      <ViewerBody
        rail={
          <DocxThumbnailRail
            currentPage={currentPage}
            editor={editor}
            onSelect={(pageIndex) => {
              revealPage({ layout, pageIndex, scrollElement, zoom });
            }}
          />
        }
        railOpen={railOpen}
      >
        {isLoading && <FileLoading />}
        {!isLoading && (
          <div
            className="absolute inset-0 overflow-auto bg-muted/40"
            ref={setScrollElement}
          >
            <DocxEditorViewer
              className="mx-auto"
              editor={editor}
              mode="read-only"
              // Both are otherwise inferred: the scroll container by walking up
              // for the nearest scrollable ancestor, and the scale by reading
              // CSS `zoom` off the ancestor chain, which cannot see the `zoom`
              // this element sets on itself. Naming them keeps the virtual page
              // offsets in step with the toolbar instead of a frame behind.
              pageVirtualization={{ scrollElement, zoomScale: zoom }}
              style={{ zoom }}
            />
          </div>
        )}
      </ViewerBody>
    </>
  );
}

function DocxThumbnailRail({
  currentPage,
  editor,
  onSelect,
}: {
  currentPage: number;
  editor: ReturnType<typeof useDocxEditor>;
  onSelect: (pageIndex: number) => void;
}) {
  const { paintThumbnail, thumbnails } = useDocxViewerThumbnails(editor, {
    maxWidthPx: THUMBNAIL_WIDTH,
  });

  return (
    <div className="flex flex-col items-center gap-2 p-3">
      {thumbnails.map((thumbnail) => (
        <button
          className={cn(
            "flex flex-col items-center gap-1 rounded-md p-1",
            currentPage === thumbnail.pageNumber
              ? "bg-accent"
              : "hover:bg-muted",
          )}
          key={thumbnail.pageIndex}
          onClick={() => {
            onSelect(thumbnail.pageIndex);
          }}
          type="button"
        >
          <canvas
            className="rounded-xs bg-white shadow-sm"
            ref={(canvas) => {
              paintThumbnail(thumbnail.pageIndex, canvas);
            }}
            style={{ height: thumbnail.height, width: thumbnail.width }}
          />
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {thumbnail.pageNumber}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Scrolls a page into view, whether or not it is currently rendered.
 *
 * The viewer exposes no imperative scroll API, so navigation goes through the
 * page wrappers' own data attribute -- but it also virtualizes, keeping only a
 * couple of pages either side of the viewport mounted. Looking the target up in
 * the DOM therefore works for a neighboring page and silently does nothing for
 * anything further away, which is most of the document.
 *
 * So the offset is computed from the page geometry, and the DOM lookup is only
 * a correction once the target has mounted. The computed offset assumes a
 * uniform page height, which is what makes the correction worth doing: a
 * document that changes page size mid-way would otherwise land near the target
 * rather than on it.
 *
 * Scoped to the viewer's own scroll container rather than the document: the
 * artifact panel keeps its viewer mounted while the expand modal renders a
 * second one for the same file, so a global lookup always resolves to the
 * panel's copy and the modal's navigation would scroll the hidden viewer.
 */
function revealPage({
  layout,
  pageIndex,
  scrollElement,
  zoom,
}: {
  layout: DocxPageLayoutInfo;
  pageIndex: number;
  scrollElement: HTMLElement | null;
  zoom: number;
}) {
  if (!scrollElement) {
    return;
  }

  const findTarget = () =>
    scrollElement.querySelector(`[data-docx-page-index="${pageIndex}"]`);

  const mounted = findTarget();
  if (mounted) {
    mounted.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const stride =
    (layout.pageHeightPx + layout.viewportDefaults.pageGapPx) * zoom;
  scrollElement.scrollTo({ behavior: "instant", top: pageIndex * stride });

  // The jump mounts the page; landing exactly on it needs the real element,
  // which only exists once the viewer has rendered that window. How many frames
  // that takes is the viewer's business, so the correction is retried over a
  // short window and then abandoned: the computed offset already lands close,
  // so giving up is a near miss rather than a failure to navigate.
  const landedAt = scrollElement.scrollTop;
  let attempts = REVEAL_CORRECTION_FRAMES;
  const correct = () => {
    // A scroll position that is no longer where the jump left it means the user
    // has taken over, and correcting now would drag them back off their page.
    if (Math.abs(scrollElement.scrollTop - landedAt) > 1) {
      return;
    }
    const target = findTarget();
    if (target) {
      target.scrollIntoView({ behavior: "instant", block: "start" });
      return;
    }
    attempts -= 1;
    if (attempts > 0) {
      requestAnimationFrame(correct);
    }
  };
  requestAnimationFrame(correct);
}

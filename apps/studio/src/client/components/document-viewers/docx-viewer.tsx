import { cn } from "@/client/lib/utils";
import {
  DocxEditorViewer,
  useDocxEditor,
  useDocxViewerThumbnails,
} from "@extend-ai/react-docx";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { ViewerBody, ViewerLoading } from "./viewer-surface";
import {
  ViewerPageControl,
  ViewerRailToggle,
  ViewerToolbar,
  ViewerToolbarSeparator,
  ViewerToolbarSpacer,
  ViewerZoomControl,
} from "./viewer-toolbar";

const THUMBNAIL_WIDTH = 104;

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
  const [zoom, setZoom] = useState(1);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(
    null,
  );
  const currentPage = useVisiblePage(scrollElement);

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
        <ViewerToolbarSeparator />
        <ViewerPageControl
          count={Math.max(editor.totalPages, 1)}
          onPageChange={(page) => {
            revealPage(page - 1);
          }}
          page={Math.min(currentPage, Math.max(editor.totalPages, 1))}
        />
        <ViewerToolbarSeparator />
        <ViewerZoomControl onZoomChange={setZoom} zoom={zoom} />
        <ViewerToolbarSpacer />
      </ViewerToolbar>

      <ViewerBody
        rail={
          <DocxThumbnailRail
            currentPage={currentPage}
            editor={editor}
            onSelect={revealPage}
          />
        }
        railOpen={railOpen}
      >
        {isLoading ? (
          <ViewerLoading />
        ) : (
          <div
            className="absolute inset-0 overflow-auto bg-muted/40"
            ref={setScrollElement}
          >
            <DocxEditorViewer
              className="mx-auto"
              editor={editor}
              mode="read-only"
              // Passing the scale explicitly keeps the viewer's virtual page
              // offsets in step with the toolbar; left to infer, it reads CSS
              // `zoom` off its ancestors and lands a frame behind.
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

// The viewer paginates internally and exposes no imperative scroll API, so
// page navigation goes through the page wrapper's own data attribute.
function revealPage(pageIndex: number) {
  const target = document.querySelector(
    `[data-docx-page-index="${pageIndex}"]`,
  );
  target?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * Which page number is currently in view, as a one-based number.
 *
 * The editor controller's own `currentPage` tracks the caret, which in
 * read-only mode never moves off whatever the paginator touched last -- a
 * freshly opened document reports its final page. Reading the scroll position
 * against the rendered page wrappers is what actually answers "what am I
 * looking at".
 */
function useVisiblePage(scrollElement: HTMLDivElement | null) {
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!scrollElement) {
      return;
    }

    let frame = 0;
    const measure = () => {
      frame = 0;
      const viewportTop = scrollElement.getBoundingClientRect().top;
      let visible = 1;
      for (const element of scrollElement.querySelectorAll<HTMLElement>(
        "[data-docx-page-index]",
      )) {
        const { bottom } = element.getBoundingClientRect();
        // The first page whose bottom edge is still below the top of the
        // viewport is the one filling it.
        if (bottom > viewportTop) {
          const index = Number(element.dataset.docxPageIndex);
          visible = Number.isFinite(index) ? index + 1 : 1;
          break;
        }
      }
      setPage(visible);
    };

    const schedule = () => {
      frame ||= requestAnimationFrame(measure);
    };

    schedule();
    scrollElement.addEventListener("scroll", schedule, { passive: true });
    // Pages mount and unmount as the viewer virtualizes, which changes what is
    // measurable without any scrolling having happened.
    const observer = new MutationObserver(schedule);
    observer.observe(scrollElement, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(frame);
      scrollElement.removeEventListener("scroll", schedule);
      observer.disconnect();
    };
  }, [scrollElement]);

  return page;
}

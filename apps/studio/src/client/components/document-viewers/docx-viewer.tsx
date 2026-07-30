import { cn } from "@/client/lib/utils";
import {
  DocxEditorViewer,
  useDocxEditor,
  useDocxViewerThumbnails,
} from "@extend-ai/react-docx";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { useTheme } from "../theme-provider";
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
  const { resolvedTheme } = useTheme();

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

  // The document surface has its own light/dark treatment (a night-reader path
  // that inverts content while preserving image hues), so it follows the app
  // theme rather than rendering a white page inside a dark shell.
  useEffect(() => {
    editor.setDocumentTheme(resolvedTheme === "dark" ? "dark" : "light");
  }, [editor, resolvedTheme]);

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
          page={Math.max(editor.currentPage, 1)}
        />
        <ViewerToolbarSeparator />
        <ViewerZoomControl onZoomChange={setZoom} zoom={zoom} />
        <ViewerToolbarSpacer />
      </ViewerToolbar>

      <ViewerBody
        rail={<DocxThumbnailRail editor={editor} onSelect={revealPage} />}
        railOpen={railOpen}
      >
        {isLoading ? (
          <ViewerLoading />
        ) : (
          <div className="absolute inset-0 overflow-auto bg-muted/40">
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
  editor,
  onSelect,
}: {
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
            editor.currentPage === thumbnail.pageNumber
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

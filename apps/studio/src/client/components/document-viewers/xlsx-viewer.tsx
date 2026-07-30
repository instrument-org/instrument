import { cn } from "@/client/lib/utils";
import {
  useXlsxViewerController,
  XlsxViewerProvider,
  XlsxViewer as XlsxWorkbookViewer,
} from "@extend-ai/react-xlsx";
import { useState } from "react";

import { useTheme } from "../theme-provider";
import { ViewerLoading } from "./viewer-surface";
import {
  ViewerToolbar,
  ViewerToolbarSeparator,
  ViewerToolbarSpacer,
  ViewerZoomControl,
} from "./viewer-toolbar";

/**
 * Spreadsheets get sheet tabs instead of a page rail, and no find control:
 * the library exposes no workbook search, and a cell walk over a live wasm
 * session is its own piece of work. Tracked in the plan.
 */
export function XlsxViewer({
  filename,
  url,
}: {
  filename: string;
  url: string;
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const controller = useXlsxViewerController({ fileName: filename, src: url });
  const [zoom, setZoom] = useState(1);

  // Thrown rather than rendered so it reaches the surface's `CatchBoundary`.
  if (controller.error) {
    throw controller.error;
  }

  return (
    <XlsxViewerProvider controller={controller} isDark={isDark}>
      <ViewerToolbar>
        <ViewerZoomControl
          onZoomChange={(level) => {
            setZoom(level);
            controller.setZoomScale(level);
          }}
          zoom={zoom}
        />
        <ViewerToolbarSeparator />
        <ViewerToolbarSpacer />
      </ViewerToolbar>

      <div className="relative min-h-0 flex-1">
        {controller.isLoading ? (
          <ViewerLoading />
        ) : (
          <XlsxWorkbookViewer
            // Row and column resizing stays available even though editing is
            // off, since a truncated column is unreadable otherwise.
            allowResizeInReadOnly
            className="absolute inset-0"
            controller={controller}
            readOnly
          />
        )}
      </div>

      {controller.sheets.length > 1 && (
        <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-t border-border/60 px-2">
          {controller.sheets.map((sheet, index) => (
            <button
              className={cn(
                "shrink-0 rounded-md px-2 py-1 text-xs whitespace-nowrap",
                controller.activeSheetIndex === index
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
              key={sheet.name}
              onClick={() => {
                controller.setActiveSheetIndex(index);
              }}
              type="button"
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}
    </XlsxViewerProvider>
  );
}

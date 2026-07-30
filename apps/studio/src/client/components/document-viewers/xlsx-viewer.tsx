import { cn } from "@/client/lib/utils";
import {
  useXlsxViewerController,
  XlsxViewerProvider,
  XlsxViewer as XlsxWorkbookViewer,
} from "@extend-ai/react-xlsx";
import { useState } from "react";

import { ViewerLoading } from "./viewer-surface";
import {
  ViewerToolbar,
  ViewerToolbarSpacer,
  ViewerZoomControl,
} from "./viewer-toolbar";

/**
 * Spreadsheets get no page rail and no find control: a workbook has sheets
 * rather than pages, and the library exposes no workbook search, so finding
 * would mean walking cells over a live wasm session. Tracked in the plan.
 *
 * `showDefaultToolbar` covers the library's whole header, sheet tabs included,
 * so turning it off means supplying the tabs here. They sit at the bottom,
 * where a spreadsheet's tabs belong, rather than above the grid.
 */
export function XlsxViewer({
  filename,
  url,
}: {
  filename: string;
  url: string;
}) {
  const controller = useXlsxViewerController({ fileName: filename, src: url });
  const [zoom, setZoom] = useState(1);

  // Thrown rather than rendered so it reaches the surface's `CatchBoundary`.
  if (controller.error) {
    throw controller.error;
  }

  // Sheets render in their own colors at every app theme, matching the PDF and
  // DOCX viewers: a workbook's cell fills and conditional formatting are
  // content, not chrome, and inverting them changes what the data looks like.
  return (
    <XlsxViewerProvider controller={controller} isDark={false}>
      <ViewerToolbar>
        <ViewerZoomControl
          onZoomChange={(level) => {
            setZoom(level);
            controller.setZoomScale(level);
          }}
          zoom={zoom}
        />
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
            showDefaultToolbar={false}
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

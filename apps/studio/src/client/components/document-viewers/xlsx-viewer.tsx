import { cn } from "@/client/lib/utils";
import {
  useXlsxViewerController,
  XlsxViewerProvider,
  XlsxViewer as XlsxWorkbookViewer,
} from "@extend-ai/react-xlsx";

import { useRegisterViewerSelection } from "./viewer-selection";
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
  // Both of these belong on the controller, not the viewer component: the
  // component reads its editing state from whichever controller it is handed,
  // and only builds one from its own props when no controller is supplied.
  // `readOnly` on the component alone leaves cell editing, paste and undo live;
  // `allowResizeInReadOnly` on the component alone leaves columns stuck at
  // their stored widths, because the controller is what resolves the two into
  // its own `canResizeReadOnly`.
  const controller = useXlsxViewerController({
    allowResizeInReadOnly: true,
    fileName: filename,
    readOnly: true,
    src: url,
  });

  // The grid is a canvas and its selection lives in the controller, so the
  // browser has nothing to copy and the library binds no copy shortcut of its
  // own. Right-click Copy comes from here instead.
  useRegisterViewerSelection({
    copy: () => {
      void controller.copySelectionToClipboard();
    },
    hasSelection: () => controller.selection !== null,
  });

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
        {/* The library counts zoom in Excel's units, where 100 is 100%, and
            clamps to its own range; handing it a 1 lands at the 10% floor. The
            readout comes back off the controller so a trackpad pinch on the
            grid moves the toolbar with it. */}
        <ViewerZoomControl
          max={controller.maxZoomScale / 100}
          min={controller.minZoomScale / 100}
          onZoomChange={(level) => {
            controller.setZoomScale(level * 100);
          }}
          zoom={controller.zoomScale / 100}
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
            showDefaultToolbar={false}
          />
        )}
      </div>

      {controller.sheets.length > 1 && (
        <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-t border-border/60 px-2">
          {controller.sheets.map((sheet, index) => (
            <button
              aria-current={
                controller.activeSheetIndex === index ? "true" : undefined
              }
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

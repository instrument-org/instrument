import { logger } from "@/client/lib/logger";
import { cn } from "@/client/lib/utils";
import {
  useXlsxViewerController,
  type XlsxViewerController,
  XlsxViewerProvider,
  XlsxViewer as XlsxWorkbookViewer,
} from "@extend-ai/react-xlsx";
import { list } from "radashi";
import { useState } from "react";

import { FileLoading } from "../file-loading";
import { tableClipboardItem, type TableCopyFormat } from "./table-clipboard";
import { TableCopyMenu } from "./table-copy-menu";
import { useCopyShortcut } from "./use-copy-shortcut";
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

  const [grid, setGrid] = useState<HTMLDivElement | null>(null);

  // The grid is a canvas and the selected range lives in the controller, so the
  // browser has nothing to copy and Chromium's menu offers nothing. The library
  // ships a `copy` handler on the grid, but the browser only raises that event
  // for a DOM selection, which a canvas can never carry, so the shortcut is
  // what makes a selection reachable at all.
  //
  // Everything below it is ours because the library's own clipboard path
  // cannot run here, for two independent reasons. `copySelectionToClipboard`
  // puts an `application/x-react-xlsx-range+json` blob alongside the text, and
  // Chromium's async clipboard rejects the whole write for any type outside
  // its small permitted set. And the payload it would write comes back null in
  // the first place: the cells live in the parse worker, so the main thread has
  // no worksheet to read, which is also why the library's `copy` handler bails.
  // Cell values come from the worker instead, through `getCellSnapshotAsync`.
  // The rows are read asynchronously and the clipboard entry is handed the
  // promise rather than awaited, which is what keeps the write attached to the
  // gesture that asked for it.
  const copyRange = (
    range: null | ReturnType<typeof selectedRange>,
    format?: TableCopyFormat,
  ) => {
    if (!range) {
      return false;
    }
    navigator.clipboard
      .write([tableClipboardItem(readRange({ controller, range }), format)])
      .catch((error: unknown) => {
        logger.error("Copying the spreadsheet failed", error);
      });
    return true;
  };

  useCopyShortcut({
    container: grid,
    onCopy: () => copyRange(selectedRange(controller)),
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
        <TableCopyMenu
          onCopy={(format) => {
            copyRange(usedRange(controller), format);
          }}
        />
      </ViewerToolbar>

      <div className="relative min-h-0 flex-1" ref={setGrid}>
        {controller.isLoading && <FileLoading />}
        {!controller.isLoading && (
          <XlsxWorkbookViewer
            // Row and column resizing stays available even though editing is
            // off, since a truncated column is unreadable otherwise.
            allowResizeInReadOnly
            className="absolute inset-0"
            controller={controller}
            rounded={false}
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

async function readRange({
  controller,
  range,
}: {
  controller: XlsxViewerController;
  range: NonNullable<ReturnType<typeof selectedRange>>;
}) {
  const sheetIndex = controller.activeSheet?.workbookSheetIndex ?? 0;
  const readCell = controller.getCellSnapshotAsync;
  return Promise.all(
    list(range.firstRow, range.lastRow).map((row) =>
      Promise.all(
        list(range.firstCol, range.lastCol).map(async (col) => {
          if (!readCell) {
            return controller.getCellDisplayValue({ col, row });
          }
          const snapshot = await readCell(sheetIndex, row, col);
          return snapshot.displayValue;
        }),
      ),
    ),
  );
}

function selectedRange(controller: XlsxViewerController) {
  const range = controller.selection ?? {
    end: controller.activeCell,
    start: controller.activeCell,
  };
  const sheet = controller.activeSheet;
  if (!range.start || !range.end || !sheet) {
    return null;
  }
  const lastRow = Math.min(
    Math.max(range.start.row, range.end.row),
    sheet.maxUsedRow,
  );
  const lastCol = Math.min(
    Math.max(range.start.col, range.end.col),
    sheet.maxUsedCol,
  );
  const firstRow = Math.min(range.start.row, range.end.row);
  const firstCol = Math.min(range.start.col, range.end.col);
  if (lastRow < firstRow || lastCol < firstCol) {
    return null;
  }
  return { firstCol, firstRow, lastCol, lastRow };
}

/**
 * The block a copy should take: the dragged selection, or the single clicked
 * cell, which is the far more common case and the one the controller records
 * as `activeCell` alone.
 *
 * Corners are ordered, since dragging up or left leaves the range inverted, and
 * clamped to the sheet's used extent so selecting whole columns copies the data
 * rather than a million blank rows.
 */
/**
 * Everything the active sheet actually holds, for a copy that was not asked to
 * respect a selection. The same clamp as `selectedRange`: a sheet's grid is a
 * million rows and its data is not.
 */
function usedRange(controller: XlsxViewerController) {
  const sheet = controller.activeSheet;
  if (!sheet || sheet.maxUsedRow < 0 || sheet.maxUsedCol < 0) {
    return null;
  }
  return {
    firstCol: 0,
    firstRow: 0,
    lastCol: sheet.maxUsedCol,
    lastRow: sheet.maxUsedRow,
  };
}

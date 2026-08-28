import {
  type CellValue,
  DataGrid,
  type GridColumn,
} from "./document-viewers/data-grid";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

/**
 * A table from a message, in the grid the task pane already shows a `.csv` in.
 *
 * The rows are the document here, not a file: there is nothing on disk to save,
 * reveal, or step to the next of, so this is its own surface rather than a
 * `TaskFileViewerFile` with three fields that would have to lie. What it does
 * reuse is the part worth reusing -- sorting, filtering, hideable and resizable
 * columns, and cell-selection copy through the same clipboard payloads the
 * table's own copy menu writes.
 */
export function MarkdownTableModal({
  columns,
  onOpenChange,
  open,
  rows,
}: {
  columns: GridColumn[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
  rows: CellValue[][];
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="flex flex-col gap-0 overflow-hidden p-0"
        maxHeight="52rem"
        maxWidth="80rem"
      >
        {/* A header row rather than a bare grid: the dialog's close control is
            pinned to its top corner, and without one it lands on top of the
            grid's own toolbar. */}
        <div className="flex h-10 shrink-0 items-center px-4">
          <DialogTitle className="text-sm font-medium">Table</DialogTitle>
        </div>
        <DataGrid columns={columns} rows={rows} />
      </DialogContent>
    </Dialog>
  );
}

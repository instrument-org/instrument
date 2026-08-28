import { type ReactNode } from "react";

import { MarkdownTable } from "./markdown-table";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

/**
 * A table from a message, with room to be read whole.
 *
 * Deliberately the same table: the same Markdown, the same styles, the same
 * copy controls, only wider. A grid with sortable headers and cell selection
 * was tried here and is the wrong answer -- opening something and having it
 * come back as a different kind of object, whose copy works differently, costs
 * more than the sorting is worth.
 *
 * The widening the block already does is what gives it the room. Naming a
 * `transcript` container here points that machinery at the dialog instead of
 * the chat column, so nothing about the table has to know where it is.
 */
export function MarkdownTableModal({
  children,
  onOpenChange,
  open,
}: {
  children?: ReactNode;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="flex flex-col gap-0 overflow-hidden p-0"
        maxHeight="52rem"
        maxWidth="80rem"
      >
        {/* A header row rather than a bare table: the dialog's close control is
            pinned to its top corner, and without one it lands on the table. */}
        <div className="flex h-10 shrink-0 items-center px-4">
          <DialogTitle className="text-sm font-medium">Table</DialogTitle>
        </div>
        <div className="@container/transcript min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <div className="prose prose-custom text-sm/relaxed [--transcript-room:100cqi] dark:prose-invert prose-table:text-sm">
            <MarkdownTable expandable={false}>{children}</MarkdownTable>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

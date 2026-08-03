import { cn } from "@/client/lib/utils";
import { CaretRightIcon } from "@phosphor-icons/react";

// The disclosure control on the compact rows the agent emits as it works: tool
// calls and reasoning. Closed, it stays out of the layout until the row is
// hovered, so the label has the row's full width to render into rather than
// truncating around a chevron the reader is not reaching for. Open, it is the
// state readout and holds its place. Expects `group/run-row` on the row.
export function RunRowChevron({ isOpen }: { isOpen: boolean }) {
  return (
    <CaretRightIcon
      className={cn(
        // The row's gap-3 is the spacing between its icon, label and chips. The
        // chevron reads as attached to what precedes it rather than as another
        // item in that sequence, so it pulls back off that gap to sit 4px out.
        "-ml-2 size-3 shrink-0 text-muted-foreground transition-transform duration-200",
        isOpen ? "rotate-90" : "hidden group-hover/run-row:block",
      )}
    />
  );
}

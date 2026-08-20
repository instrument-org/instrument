import { cn } from "@/client/lib/utils";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";

// The disclosure control on the compact rows the agent emits as it works: tool
// calls and reasoning. Quiet until the row is hovered, and the state readout
// once the row is open. Expects `group/run-row` on the row.
export function RunRowChevron({ isOpen }: { isOpen: boolean }) {
  return (
    <CaretRightIcon
      className={cn(
        // The row's gap-2 is the spacing between its icon, label and chips. The
        // chevron reads as attached to what precedes it rather than as another
        // item in that sequence, so it pulls back off that gap to sit 4px out.
        "-ml-1 size-3 shrink-0 text-muted-foreground transition-[opacity,transform] duration-200",
        // Faded rather than taken out of the layout, so the row is one width in
        // every state. Removing it instead saved a few px of label and cost the
        // reader the control: the row's box is its content, so a chevron that
        // only exists while hovered puts the row's own edge under the pointer
        // aiming for it -- and leaving that edge takes the chevron away, which
        // narrows the row, which puts the pointer further outside it still.
        isOpen
          ? "rotate-90"
          : "opacity-0 group-hover/run-row:opacity-100 group-focus-visible/run-row:opacity-100",
      )}
    />
  );
}

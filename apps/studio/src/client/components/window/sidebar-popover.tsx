import { PopoverAnchor } from "@/client/components/ui/popover";
import { cn } from "@/client/lib/utils";

/**
 * An icon button in the sidebar's top row or foot. Its focus ring is drawn
 * inside it, since the last one in a row ends at the edge the sidebar is
 * clipped to.
 */
export const SIDEBAR_ICON_BUTTON =
  "grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:-outline-offset-2";

/**
 * What a popover over the sidebar opens from in place of its button: a line
 * from one edge of the sidebar's rows to the other, at the top or bottom of
 * the row of buttons the trigger is in, which has to be `relative`. It has
 * no height, so it covers none of what that row drags the window by.
 */
export function SidebarPopoverAnchor({ side }: { side: "bottom" | "top" }) {
  return (
    <PopoverAnchor
      className={cn(
        "pointer-events-none absolute right-0 left-2 h-0",
        // The row centers it, so half an icon button's height reaches the
        // buttons' edge.
        side === "top" ? "-translate-y-3.5" : "translate-y-3.5",
      )}
    />
  );
}

/**
 * The width of the sidebar's rows, for a popover that opens from a
 * `SidebarPopoverAnchor`. Radix measures the anchor in on-screen px, and the
 * content applies the zoom to its own units.
 */
export const SIDEBAR_POPOVER_WIDTH =
  "calc(var(--radix-popover-trigger-width) / var(--content-zoom))";

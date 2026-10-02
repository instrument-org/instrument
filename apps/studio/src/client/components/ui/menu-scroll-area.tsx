import { cn } from "@/client/lib/utils";
import { type ReactNode } from "react";

/**
 * The scrolling body of a menu whose list can outrun the room it has, so the
 * cut-off row fades instead of ending on a blade and the list reads as having
 * more in it.
 *
 * It exists because the fade cannot go on the menu itself. `scroll-fade-y` is a
 * mask, and a mask takes everything the element paints: worn by the menu --
 * which is the scroller by default, and also the thing painting `bg-popover`
 * and its shadow -- it dissolves the menu's own surface at the bottom edge and
 * shows the window through the gap. Held one layer in, with nothing of its own
 * to paint, it fades only the rows, onto the popover behind them. That is also
 * the answer to which color the fade should be: it has none.
 *
 * The menu around it takes `flex flex-col p-0`, moving its padding in here. The
 * flex column is what lets this shrink under the menu's own cap -- the one
 * Radix sets from the room below the trigger -- rather than overflowing it into
 * a second scrollbar. Where a menu wants a tighter cap than that, it passes one
 * as `className` and keeps Radix's as the outer bound.
 */
export function MenuScrollArea({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-h-0 overflow-y-auto scroll-fade-y p-1", className)}>
      {children}
    </div>
  );
}

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { cn } from "@/client/lib/utils";
import { type ReactNode } from "react";

import { type RowAction, type RowDensity, stopHere } from "./row-shell";

/**
 * A row's own controls, in its top corner while the pointer is on the row,
 * where the pills step aside for them, on a tile so what is under them does
 * not show through: the control that files it, then its actions. Out of the flow at rest, so
 * nothing on the row moves when they arrive, and in the flow while one of
 * them holds a menu open, so the menu keeps its anchor. Each is its mark
 * alone, named in its tooltip, and a click on one stops short of the row
 * under it; a right click is the row's, since the bar is over the row's
 * corner whenever the pointer is. The star at the row's foot is not among
 * them: it stays in view.
 */
export function RowActionBar({
  actions,
  density,
  isHeld = false,
  leading,
}: {
  actions: RowAction[];
  density: RowDensity;
  /** Kept in the flow whatever the pointer does: while a menu of one of the controls is on its way out. */
  isHeld?: boolean;
  /** The control in front of the actions: the one that files the thread. */
  leading?: ReactNode;
}) {
  const shown = actions.filter((action) => !action.menuOnly);
  if (shown.length === 0 && !leading) {
    return null;
  }
  return (
    <span
      className={cn(
        "hidden shrink-0 items-center gap-0.5 rounded-md bg-background p-0.5 shadow-xs ring-1 ring-border group-hover/row:flex focus-within:flex has-[[data-state=open]]:flex",
        // In the corner outright on a tall row, over the pills that step
        // aside for it; on a slim row, in the flow where the pills were, so
        // the holds before it stay in reach.
        density === "slim" ? undefined : "absolute top-1.5 right-1.5",
        isHeld && "flex",
      )}
      onAuxClick={stopHere}
      onClick={stopHere}
      onKeyDown={stopHere}
    >
      {leading}
      {shown.map((action) => (
        <Tooltip key={action.id}>
          <TooltipTrigger asChild>
            <button
              aria-label={action.label}
              className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
              onClick={(event) => {
                // The press leaves the button, or the bar would stay for
                // the focus it left there after the pointer had gone.
                event.currentTarget.blur();
                action.run();
              }}
              type="button"
            >
              {action.icon}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{action.label}</TooltipContent>
        </Tooltip>
      ))}
    </span>
  );
}

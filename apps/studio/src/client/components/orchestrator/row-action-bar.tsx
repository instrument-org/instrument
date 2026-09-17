import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { cn } from "@/client/lib/utils";

import { type RowAction, type RowDensity, stopHere } from "./row-shell";

/**
 * A row's own actions, over the time at its right end while the pointer is
 * on the row, on a tile so the time under them does not show through. Out
 * of the flow at rest, so nothing on the row moves when they arrive. Each is
 * its mark alone, named in its tooltip, and a click on one stops short of
 * the row under it.
 */
export function RowActionBar({
  actions,
  density,
}: {
  actions: RowAction[];
  density: RowDensity;
}) {
  if (actions.length === 0) {
    return null;
  }
  return (
    <span
      className={cn(
        "absolute right-1.5 hidden items-center gap-0.5 rounded-md bg-background p-0.5 shadow-xs ring-1 ring-border group-hover/row:flex focus-within:flex",
        density === "slim" ? "top-1/2 -translate-y-1/2" : "top-1.5",
      )}
      onAuxClick={stopHere}
      onClick={stopHere}
      onContextMenu={stopHere}
      onKeyDown={stopHere}
    >
      {actions.map((action) => (
        <Tooltip key={action.id}>
          <TooltipTrigger asChild>
            <button
              aria-label={action.label}
              className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
              onClick={action.run}
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

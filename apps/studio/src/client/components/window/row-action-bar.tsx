import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { ICON_CONTEXT_VALUE } from "@/client/lib/icon-context";
import { type IconProps } from "@phosphor-icons/react";
import { IconContext } from "@phosphor-icons/react/dist/lib/context";
import { type ReactNode } from "react";

import { type RowAction, stopHere } from "./row-shell";

/** The app's icon defaults, at the regular weight. */
const ROW_ICONS: IconProps = { ...ICON_CONTEXT_VALUE, weight: "regular" };

/**
 * The end of a row's first line, which wears what the row says at rest (its
 * pills, its star, its time) and swaps it for the row's own controls while
 * the pointer is on the row, one of them has focus, or one holds a menu
 * open: the control that files it, then its actions. In the line's flow, so
 * the title truncates short of them rather than running under them, and
 * bare on the row's tint, with no tile. Each is its mark alone, named in its
 * tooltip, and a click on one stops short of the row under it; a right click
 * is the row's. Each control is a 24px square around a 16px mark, the box a
 * starred row's star stands in at rest, so the star the bar ends on lands
 * where that star was. The marks are drawn in the regular weight rather than
 * the app's bold, which reads heavy as a row of five.
 */

export function RowActionBar({
  actions,
  isHeld = false,
  leading,
  resting,
}: {
  actions: RowAction[];
  /** Kept up whatever the pointer does: while a menu of one of the controls is on its way out. */
  isHeld?: boolean;
  /** The control in front of the actions: the one that files the chat. */
  leading?: ReactNode;
  /** What the line's end wears while the controls are down. */
  resting?: ReactNode;
}) {
  const shown = actions.filter((action) => !action.menuOnly);
  if (shown.length === 0 && !leading) {
    return resting;
  }
  return (
    <span
      className="group/corner ml-auto flex shrink-0 items-center"
      data-held={isHeld || undefined}
    >
      {resting && (
        <span className="flex items-center gap-1 group-focus-within/corner:hidden group-hover/row:hidden group-has-data-[state=open]/corner:hidden group-data-held/corner:hidden">
          {resting}
        </span>
      )}
      <span
        // 24px controls on a 20px line, which they overhang rather than grow.
        className="-my-0.5 hidden items-center gap-0.5 group-focus-within/corner:flex group-hover/row:flex group-has-data-[state=open]/corner:flex group-data-held/corner:flex"
        data-slot="row-actions"
        onAuxClick={stopHere}
        onClick={stopHere}
        onKeyDown={stopHere}
      >
        <IconContext.Provider value={ROW_ICONS}>
          {leading}
          {shown.map((action) => (
            <Tooltip key={action.id}>
              <TooltipTrigger asChild>
                <button
                  aria-label={action.label}
                  className={ROW_CONTROL}
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
        </IconContext.Provider>
      </span>
    </span>
  );
}

/** One of the row's controls: a 24px square around its 16px mark, whatever size the action drew it. */
export const ROW_CONTROL =
  "grid size-6 shrink-0 place-items-center rounded-md text-foreground/50 hover:bg-foreground/8 hover:text-foreground data-[state=open]:bg-foreground/8 data-[state=open]:text-foreground [&_svg]:size-4";

import { ArrowBendDownRightIcon } from "@phosphor-icons/react/ArrowBendDownRight";
import { type ReactNode } from "react";

import { MESSAGE_FOOTER_ICON_SIZE } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { ShortcutKeys } from "../shortcut-keys";

/**
 * Ideas as rows drawn as a chat's next-message rows are (`next-steps.tsx`):
 * the bent arrow, the muted line, a wash under the pointer, and ⌘↩ on the
 * first while the box is empty. With words in the box the rows step back.
 * A press never takes the caret from the box. `highlighted` is the row the
 * box's arrow keys are on, washed as under the pointer and marked ↩.
 */
export function IdeaRows({
  className,
  highlighted,
  isBoxEmpty,
  lines,
  onSend,
  trailing,
}: {
  className?: string;
  highlighted?: number;
  isBoxEmpty: boolean;
  lines: readonly string[];
  onSend: (line: string) => void;
  /** Shown at the rows' end while the pointer is over them. */
  trailing?: ReactNode;
}) {
  if (lines.length === 0) {
    return null;
  }
  return (
    <div
      aria-label="Ideas"
      className={cn(
        "group/ideas flex animate-in flex-col items-start transition-opacity duration-150 fade-in-0 slide-in-from-bottom-1",
        !isBoxEmpty &&
          highlighted === undefined &&
          "opacity-60 hover:opacity-100",
        className,
      )}
      role="group"
    >
      {lines.map((line, index) => {
        const isHighlighted = index === highlighted;
        const keys = isHighlighted
          ? "Enter"
          : highlighted === undefined && index === 0 && isBoxEmpty
            ? "CmdOrCtrl+Enter"
            : undefined;
        return (
          <button
            className={cn(
              "group/next-step -mx-1 flex h-7 max-w-full items-center gap-1 text-left text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground",
              isHighlighted && "text-foreground",
            )}
            key={line}
            onClick={() => {
              onSend(line);
            }}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            type="button"
          >
            <span
              className={cn(
                "shrink-0 p-1 text-muted-foreground/60 group-hover/next-step:text-foreground/70",
                isHighlighted && "text-foreground/70",
              )}
            >
              <ArrowBendDownRightIcon size={MESSAGE_FOOTER_ICON_SIZE} />
            </span>
            <span
              className={cn(
                "min-w-0 truncate rounded-md px-1.5 py-0.5 group-hover/next-step:bg-muted/50 group-focus-visible/next-step:bg-muted/50",
                isHighlighted && "bg-muted/50",
              )}
            >
              {line}
            </span>
            {keys && (
              <span className="shrink-0 opacity-80">
                <ShortcutKeys accelerator={keys} />
              </span>
            )}
          </button>
        );
      })}
      {trailing && (
        <div className="pointer-events-none mt-0.5 opacity-0 transition-opacity duration-150 group-hover/ideas:pointer-events-auto group-hover/ideas:opacity-100">
          {trailing}
        </div>
      )}
    </div>
  );
}

import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Spinner } from "@/client/components/ui/spinner";
import { cn } from "@/client/lib/utils";
import { SparkleIcon } from "@phosphor-icons/react/Sparkle";
import { useRef, useState } from "react";

import { type ThreadRename } from "./use-thread-rename";

// The field's own padding plus the sparkle inside it, so a width built from
// the measured title fits the same text without truncating it on arrival.
const FIELD_PADDING = 56;
// Enough for a few words: renaming "Fix" in a field the width of "Fix" is
// worse than the small jump this costs.
const FIELD_MIN_WIDTH = 160;
// A plain medium field when the title was never measured.
const FIELD_DEFAULT_WIDTH = 320;

/**
 * A thread's title that renames it when clicked, the way a task's title does
 * on its page: a button with a hover surface, then a field in its place with
 * the sparkle at its far end. Only where the thread is being viewed, its head
 * and its small view; the inbox's rows open the thread instead.
 */
export function ThreadTitle({
  className,
  grow = false,
  rename,
  title,
}: {
  /** The type the title is set in, which the field takes too. */
  className: string;
  /** Whether the field takes the row's free width rather than the title's own. */
  grow?: boolean;
  rename: ThreadRename;
  title: string;
}) {
  const titleRef = useRef<HTMLButtonElement>(null);
  const [fieldWidth, setFieldWidth] = useState<number>();

  if (rename.isEditing) {
    // The field opens at the width of the title it replaced, measured in
    // layout px (offsetWidth, not a rect) since the app scales with CSS zoom.
    // select-text because the head turns selection off, which would leave a
    // name you can't drag a selection through.
    return (
      <div
        className={cn(
          "relative flex h-8 min-w-0 items-center select-text",
          grow ? "flex-1" : "max-w-96 shrink",
        )}
        style={grow ? undefined : { width: fieldWidth ?? FIELD_DEFAULT_WIDTH }}
      >
        <Input
          className={cn("h-7 pr-8 focus-visible:-outline-offset-3", className)}
          {...rename.inputProps}
          readOnly={rename.isSuggesting}
        />
        <div className="absolute right-1 flex">
          <ToolbarTooltip label="Name it from the conversation">
            <Button
              aria-label="Name it from the conversation"
              className="size-6"
              disabled={rename.isSuggesting}
              onClick={rename.suggest}
              // Keeps the field focused: a blur would save and close it
              // before the press lands.
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              size="icon-sm"
              variant="ghost"
            >
              {rename.isSuggesting ? (
                <Spinner className="size-3.5" />
              ) : (
                <SparkleIcon className="size-3.5" />
              )}
            </Button>
          </ToolbarTooltip>
        </div>
      </div>
    );
  }

  // The hover surface is pulled back out by its own padding, so what sits
  // beside the title stays measured from the text rather than from the fill.
  return (
    <button
      className={cn(
        "-mx-1.5 flex h-8 min-w-0 items-center rounded-lg px-1.5 text-left outline-none hover:bg-muted focus-visible:outline-[3px] focus-visible:-outline-offset-3 focus-visible:outline-ring/50 focus-visible:[outline-style:solid]",
        className,
      )}
      onClick={() => {
        setFieldWidth(
          titleRef.current
            ? Math.max(
                FIELD_MIN_WIDTH,
                titleRef.current.offsetWidth + FIELD_PADDING,
              )
            : undefined,
        );
        rename.start();
      }}
      ref={titleRef}
      type="button"
    >
      <span className="min-w-0 truncate">{title}</span>
    </button>
  );
}

import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Spinner } from "@/client/components/ui/spinner";
import { cn } from "@/client/lib/utils";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { SparkleIcon } from "@phosphor-icons/react/Sparkle";
import { type ComponentProps } from "react";

import { type ChatRename } from "./use-chat-rename";

// The field's own padding plus the sparkle inside it, less the title's caret,
// so a width built from the measured title fits the same text without
// truncating it on arrival.
const FIELD_PADDING = 40;
// Enough for a few words: renaming "Fix" in a field the width of "Fix" is
// worse than the small jump this costs.
const FIELD_MIN_WIDTH = 160;
// A plain medium field when the title was never measured.
const FIELD_DEFAULT_WIDTH = 320;

/**
 * Where a chat's title is renamed, in the title's place: a field the width
 * of the title it replaced, with the sparkle at its far end that names the
 * chat from its conversation. Only where the chat is being viewed, its head
 * and its small view; the inbox's rows rename from their menu's dialog.
 */
export function ChatTitleField({
  className,
  grow = false,
  rename,
  width,
}: {
  /** The type the title is set in, which the field takes too. */
  className: string;
  /** Whether the field takes the row's free width rather than the title's own. */
  grow?: boolean;
  rename: ChatRename;
  /** The title's width in layout px, measured as renaming began; a plain medium field without one. */
  width: number | undefined;
}) {
  // select-text because the window turns selection off, which would leave a
  // name you can't drag a selection through.
  return (
    <div
      className={cn(
        "relative flex h-8 min-w-0 items-center select-text",
        grow ? "flex-1" : "max-w-96 shrink",
      )}
      style={
        grow
          ? undefined
          : {
              width:
                width === undefined
                  ? FIELD_DEFAULT_WIDTH
                  : Math.max(FIELD_MIN_WIDTH, width + FIELD_PADDING),
            }
      }
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
              <Spinner className="size-3.5" delay={0} />
            ) : (
              <SparkleIcon className="size-3.5" />
            )}
          </Button>
        </ToolbarTooltip>
      </div>
    </div>
  );
}

/**
 * A chat's title as the press that opens the chat's menu: the title and a
 * caret on a hover surface, lit while the menu is open. Its props and ref
 * are the menu trigger's, which it stands in for.
 */
export function ChatTitleButton({
  className,
  title,
  ...props
}: Omit<ComponentProps<"button">, "title"> & { title: string }) {
  // The hover surface is pulled back out by its own padding, so what sits
  // beside the title stays measured from the text rather than from the fill.
  // Held to the rename field's widest, so a long title truncates there
  // rather than running the width of a wide head.
  return (
    <button
      {...props}
      className={cn(
        "-mx-1.5 flex h-8 max-w-96 min-w-0 items-center gap-1 rounded-lg px-1.5 text-left outline-none hover:bg-muted focus-visible:outline-[3px] focus-visible:-outline-offset-3 focus-visible:outline-ring/50 focus-visible:[outline-style:solid] data-[state=open]:bg-muted",
        className,
      )}
      type="button"
    >
      <span className="min-w-0 truncate">{title}</span>
      <CaretDownIcon className="size-3 shrink-0 text-muted-foreground" />
    </button>
  );
}

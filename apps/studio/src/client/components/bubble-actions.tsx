import { MESSAGE_FOOTER_ICON_SIZE, SHARED } from "@/client/lib/styles";
import { cn } from "@/client/lib/utils";

import { CopyButton } from "./copy-button";
import { RelativeTime } from "./relative-time";

/**
 * A bubble's controls, drawn in the empty width beside it rather than in a row
 * under it, so a conversation of short lines keeps its lines close together.
 * They show while the pointer is anywhere on the bubble's row
 * (`group/bubble-row`) or focus is inside them, and hold their place either
 * way, so the bubble never moves when they appear.
 *
 * `side` is which side of the bubble they stand on; the copy button is always
 * the one next to the bubble.
 */
export function BubbleActions({
  date,
  onCopy,
  side,
}: {
  date: Date;
  onCopy: () => Promise<void>;
  side: "left" | "right";
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1 pb-0.5 text-xs text-muted-foreground opacity-0 group-hover/bubble-row:opacity-100 focus-within:opacity-100",
        side === "left" && "flex-row-reverse",
      )}
    >
      <CopyButton
        className={SHARED.messageFooterButton}
        iconSize={MESSAGE_FOOTER_ICON_SIZE}
        label="Copy message"
        onCopy={onCopy}
        tooltip="Copy message"
      />
      {/* Only where the transcript has the room: in a narrow one the width
          beside a bubble is barely the button's. */}
      <RelativeTime
        className="hidden cursor-default whitespace-nowrap @md/transcript:inline"
        compact
        date={date}
      />
    </div>
  );
}

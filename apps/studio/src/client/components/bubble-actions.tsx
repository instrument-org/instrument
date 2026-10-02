import { MESSAGE_FOOTER_ICON_SIZE, SHARED } from "@/client/lib/styles";
import { ArrowBendUpLeftIcon } from "@phosphor-icons/react/ArrowBendUpLeft";

import { CopyButton } from "./copy-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * A bubble's controls, drawn in the empty width beside it rather than in a row
 * under it, so a conversation of short lines keeps its lines close together.
 * They show while the pointer is anywhere on the bubble's row
 * (`group/bubble-row`) or focus is inside them, and hold their place either
 * way, so the bubble never moves when they appear.
 */
export function BubbleActions({
  onCopy,
  onReply,
}: {
  onCopy: () => Promise<void>;
  /** Absent where there is no composer for the reply to go to. */
  onReply?: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center pb-0.5 opacity-0 group-hover/bubble-row:opacity-100 focus-within:opacity-100">
      <CopyButton
        className={SHARED.messageFooterButton}
        iconSize={MESSAGE_FOOTER_ICON_SIZE}
        label="Copy message"
        onCopy={onCopy}
        tooltip="Copy message"
      />
      {onReply && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label="Reply"
              className={SHARED.messageFooterButton}
              onClick={onReply}
              type="button"
            >
              <ArrowBendUpLeftIcon size={MESSAGE_FOOTER_ICON_SIZE} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Reply</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

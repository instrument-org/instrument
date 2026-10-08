import { MESSAGE_FOOTER_ICON_SIZE, SHARED } from "@/client/lib/styles";
import { cn } from "@/client/lib/utils";
import { renderSkillMentionsAsText } from "@instrument-org/shared/skill-mention";
import { type SessionMessagePart } from "@instrument-org/workspace/client";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CaretUpIcon } from "@phosphor-icons/react/CaretUp";
import { debounce } from "radashi";
import { memo, useContext, useEffect, useRef, useState } from "react";

import { BubbleActions } from "./bubble-actions";
import { FollowedBubblesContext } from "./bubble-run-context";
import { CopyButton } from "./copy-button";
import { RelativeTime } from "./relative-time";
import { SkillMentionText } from "./skill-mention-text";
import { useReleaseAutoScroll } from "./transcript-scroll-context";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface UserMessageProps {
  /** A tighter bubble with no footer under it, for a narrow transcript. */
  compact?: boolean;
  part: SessionMessagePart.TextPart;
}

// The height a collapsed message clamps to: fifteen and a half of `text-sm`'s
// 20px lines, so the cut lands in the middle of a line rather than between two,
// where a clipped message would read as one that simply ended. One constant
// rather than a class and a number, because the height the bubble clamps at and
// the height the overflow check measures against have to be the same: a
// message taller than one and shorter than the other gets a fade and a
// click-to-expand target over text that was never cut off.
const COLLAPSED_MAX_HEIGHT_PX = 310;

// The row under the message that opens or closes it, the same in both states so
// the control stays where the reader last found it.
const TOGGLE_ROW_CLASS =
  "flex w-full cursor-pointer items-center justify-center gap-1 pt-2 text-xs text-muted-foreground hover:text-foreground";

export const UserMessage = memo(function UserMessage({
  compact = false,
  part,
}: UserMessageProps) {
  const releaseAutoScroll = useReleaseAutoScroll();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const isFollowed = useContext(FollowedBubblesContext).has(part.metadata.id);

  const messageText = part.text;

  const handleCopy = async () => {
    // Copy what is on screen. Neither form round trips back into the composer
    // as a token, so the serialized one is only noise to whoever pastes it.
    await navigator.clipboard.writeText(renderSkillMentionsAsText(messageText));
  };

  useEffect(() => {
    const element = contentRef.current;
    if (!element) {
      return;
    }

    // `scrollHeight` is the full content height under either clamp, so this
    // answers the same question expanded or collapsed without borrowing the
    // element's styles to measure through.
    const checkOverflow = () => {
      setIsOverflowing(element.scrollHeight > COLLAPSED_MAX_HEIGHT_PX);
    };

    checkOverflow();

    const debouncedCheckOverflow = debounce({ delay: 100 }, checkOverflow);
    const resizeObserver = new ResizeObserver(debouncedCheckOverflow);
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, [messageText]);

  return (
    <div className="group flex w-full flex-col items-end">
      {/* The bubble's row, full width so the bubble's share is of the column,
          and the room beside it where the conversation puts its controls. */}
      <div className="group/bubble-row flex w-full items-end justify-end gap-1">
        {compact && <BubbleActions onCopy={handleCopy} />}
        <div
          className={cn(
            "relative max-w-[80%] text-foreground",
            // In the conversation the user's bubble wears the brand's tint,
            // rebuilt light and soft from the brand's hue since no token of the
            // scale sits there, with soft corners and, on the last of a run,
            // the short one at the bottom right, facing the assistant's on the
            // card's ground; on a task page it is a card of its own.
            compact
              ? "rounded-2xl bg-[oklch(from_var(--color-brand-500)_0.85_0.05_h)] px-3.5 py-2 dark:bg-[oklch(from_var(--color-brand-500)_0.36_0.06_h)]"
              : "rounded-tl-xl rounded-tr rounded-br-xl rounded-bl-xl bg-linear-to-b from-card to-gray-25 px-4 py-3 shadow-sm dark:from-card dark:to-card",
            compact && !isFollowed && "rounded-br-md",
          )}
        >
          <Collapsible
            onOpenChange={(open) => {
              releaseAutoScroll();
              setIsExpanded(open);
            }}
            open={isExpanded}
          >
            <div className="relative">
              <div
                className={cn(
                  isExpanded ? "max-h-128 overflow-y-auto" : "overflow-hidden",
                )}
                data-slot="user-message-content"
                ref={contentRef}
                style={
                  isExpanded
                    ? undefined
                    : { maxHeight: COLLAPSED_MAX_HEIGHT_PX }
                }
              >
                <div className="text-sm break-words whitespace-pre-wrap">
                  <SkillMentionText text={messageText} />
                </div>
              </div>

              {/* Over the text rather than the bubble's edge, so the last lines
                  visibly thin out above the row that says there is more. */}
              {!isExpanded && isOverflowing && (
                <div
                  className={cn(
                    "pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-t",
                    compact
                      ? "from-[oklch(from_var(--color-brand-500)_0.85_0.05_h)] to-[oklch(from_var(--color-brand-500)_0.85_0.05_h/0)] dark:from-[oklch(from_var(--color-brand-500)_0.36_0.06_h)] dark:to-[oklch(from_var(--color-brand-500)_0.36_0.06_h/0)]"
                      : "from-gray-25 to-gray-25/0 dark:from-card dark:to-card/0",
                  )}
                />
              )}
            </div>

            {!isExpanded && isOverflowing && (
              <CollapsibleTrigger asChild>
                {/* A row anyone can see, named by its own text, and its `after`
                  stretches over the whole bubble so a press anywhere on the
                  clipped message expands it too. The bubble is the positioned
                  ancestor that box fills, so the row itself must not be. */}
                <button
                  className={cn(
                    TOGGLE_ROW_CLASS,
                    "after:absolute after:inset-0",
                  )}
                  data-slot="user-message-expand"
                  type="button"
                >
                  <span>Show more</span>
                  <CaretDownIcon className="size-3" />
                </button>
              </CollapsibleTrigger>
            )}

            <CollapsibleContent>
              {/* The other half of the pair above, and it has to be a control for
                the same reason: expanding was reachable and collapsing was not,
                so a message opened from the keyboard could not be closed again.
                The trigger carries the state, so no handler of its own. */}
              <CollapsibleTrigger asChild>
                <button
                  className={TOGGLE_ROW_CLASS}
                  data-slot="user-message-collapse"
                  type="button"
                >
                  <span>Show less</span>
                  <CaretUpIcon className="size-3" />
                </button>
              </CollapsibleTrigger>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </div>
      {compact ? null : (
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground opacity-0 group-hover:opacity-100">
          <RelativeTime
            className="cursor-default"
            date={part.metadata.createdAt}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <CopyButton
                className={SHARED.messageFooterButton}
                iconSize={MESSAGE_FOOTER_ICON_SIZE}
                onCopy={handleCopy}
              />
            </TooltipTrigger>
            <TooltipContent>Copy message</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
});

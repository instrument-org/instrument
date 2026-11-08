import {
  isAllDictated,
  stripDictatedMarks,
} from "@instrument-org/shared/dictated-text";
import { MESSAGE_FOOTER_ICON_SIZE, SHARED } from "@/client/lib/styles";
import { cn } from "@/client/lib/utils";
import { renderSkillMentionsAsText } from "@instrument-org/shared/skill-mention";
import { type SessionMessagePart } from "@instrument-org/workspace/client";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CaretUpIcon } from "@phosphor-icons/react/CaretUp";
import { MicrophoneIcon } from "@phosphor-icons/react/Microphone";
import { debounce } from "radashi";
import { memo, useEffect, useRef, useState } from "react";

import { CopyButton } from "./copy-button";
import { SkillMentionText } from "./skill-mention-text";
import { useReleaseAutoScroll } from "./transcript-scroll-context";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";

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

// Each tone's fill, and the fade over a clipped message's last lines in it.
// The brand's tint is rebuilt light and soft from its hue since no token of
// the scale sits there.
const TONES = {
  chat: { fade: "from-muted to-muted/0", fill: "bg-muted" },
  you: {
    fade: "from-[oklch(from_var(--color-brand-500)_0.85_0.05_h)] to-[oklch(from_var(--color-brand-500)_0.85_0.05_h/0)] dark:from-[oklch(from_var(--color-brand-500)_0.36_0.06_h)] dark:to-[oklch(from_var(--color-brand-500)_0.36_0.06_h/0)]",
    fill: "bg-[oklch(from_var(--color-brand-500)_0.85_0.05_h)] dark:bg-[oklch(from_var(--color-brand-500)_0.36_0.06_h)]",
  },
};

export const UserMessage = memo(function UserMessage({
  part,
}: {
  part: SessionMessagePart.TextPart;
}) {
  return (
    <div className="group flex w-full flex-col items-end">
      <MessageBubble text={part.text} tone="you" />
      {isAllDictated(part.text) && (
        <div className="mt-1 flex items-center gap-1 pr-1 text-xs text-muted-foreground">
          <MicrophoneIcon className="size-3.5" />
          <span>Dictated</span>
        </div>
      )}
    </div>
  );
});

/**
 * Words sent into a session, on the sender's side: yours in the brand's tint,
 * the chat's to a task in gray. Links, paths and skills read as they do in the
 * composer, and a long message clips with Show more.
 */
export function MessageBubble({
  text: messageText,
  tone,
}: {
  text: string;
  tone: keyof typeof TONES;
}) {
  const releaseAutoScroll = useReleaseAutoScroll();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const handleCopy = async () => {
    // Copy what is on screen. Neither form round trips back into the composer
    // as a token, so the serialized one is only noise to whoever pastes it.
    await navigator.clipboard.writeText(
      stripDictatedMarks(renderSkillMentionsAsText(messageText)),
    );
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
    <>
      {/* The bubble's row, full width so the bubble's share is of the column,
          with Copy in the room beside it, showing while the pointer is on the
          row and holding its place either way, so the bubble never moves. */}
      <div className="group/bubble-row flex w-full items-end justify-end gap-1">
        <div className="flex shrink-0 items-center pb-0.5 opacity-0 group-hover/bubble-row:opacity-100 focus-within:opacity-100">
          <CopyButton
            className={SHARED.messageFooterButton}
            iconSize={MESSAGE_FOOTER_ICON_SIZE}
            label="Copy message"
            onCopy={handleCopy}
            tooltip="Copy message"
          />
        </div>
        <div
          className={cn(
            "relative max-w-[80%] rounded-2xl rounded-br-md px-3.5 py-2 text-foreground",
            TONES[tone].fill,
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
              {/* Opened, a message shows whole up to about eighty lines, so
                  only a pasted log or file scrolls inside the transcript's own
                  scroll. A fixed length rather than a share of the viewport,
                  which the window's zoom would throw off. */}
              <div
                className={cn(
                  isExpanded ? "max-h-400 overflow-y-auto" : "overflow-hidden",
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
                    TONES[tone].fade,
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
    </>
  );
}

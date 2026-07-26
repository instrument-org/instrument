import { cn } from "@/client/lib/utils";
import { renderSkillMentionsAsText } from "@instrument-org/shared/skill-mention";
import { type SessionMessagePart } from "@instrument-org/workspace/client";
import { CaretUpIcon } from "@phosphor-icons/react";
import { debounce } from "radashi";
import { memo, useEffect, useRef, useState } from "react";

import { CopyButton } from "./copy-button";
import { RelativeTime } from "./relative-time";
import { SkillMentionText } from "./skill-mention-text";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface UserMessageProps {
  part: SessionMessagePart.TextPart;
}

// The height a collapsed message clamps to, chosen so the fade lands in the
// middle of a line rather than between two. One constant rather than a class
// and a number, because the height the bubble clamps at and the height the
// overflow check measures against have to be the same: a message taller than
// one and shorter than the other gets a fade and a click-to-expand target over
// text that was never cut off.
const COLLAPSED_MAX_HEIGHT_PX = 216;

export const UserMessage = memo(function UserMessage({
  part,
}: UserMessageProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

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
      <div className="relative max-w-[80%] rounded-tl-xl rounded-tr rounded-br-xl rounded-bl-xl bg-linear-to-b from-card to-gray-25 px-4 py-2 text-foreground shadow-sm dark:from-card dark:to-card">
        <Collapsible onOpenChange={setIsExpanded} open={isExpanded}>
          <div
            className={cn(
              isExpanded ? "max-h-128 overflow-y-auto" : "overflow-hidden",
            )}
            data-slot="user-message-content"
            ref={contentRef}
            style={
              isExpanded ? undefined : { maxHeight: COLLAPSED_MAX_HEIGHT_PX }
            }
          >
            <div className="text-sm break-words whitespace-pre-wrap">
              <SkillMentionText text={messageText} />
            </div>
          </div>

          {!isExpanded && isOverflowing && (
            <CollapsibleTrigger asChild>
              <button
                className="absolute inset-0 cursor-pointer"
                data-slot="user-message-expand"
                type="button"
              />
            </CollapsibleTrigger>
          )}

          {!isExpanded && isOverflowing && (
            <div className="pointer-events-none absolute right-0 bottom-0 left-0 h-12 rounded-br-xl rounded-bl-xl bg-linear-to-t from-gray-25 from-50% to-gray-25/0 dark:from-card dark:to-card/0" />
          )}

          <CollapsibleContent>
            <div
              className="flex cursor-pointer items-center justify-center gap-1 pt-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => {
                setIsExpanded(false);
              }}
              title="Click to collapse"
            >
              <span>Collapse</span>
              <CaretUpIcon className="size-3" />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
        <RelativeTime
          className="cursor-default"
          date={part.metadata.createdAt}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <CopyButton
              className="rounded-sm p-1 transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
              iconSize={12}
              onCopy={handleCopy}
            />
          </TooltipTrigger>
          <TooltipContent>Copy message</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
});

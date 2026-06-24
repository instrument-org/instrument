import { cn } from "@/client/lib/utils";
import { type SessionMessagePart } from "@instrument-org/workspace/client";
import { CaretUpIcon } from "@phosphor-icons/react";
import { debounce } from "radashi";
import { memo, useEffect, useRef, useState } from "react";

import { CopyButton } from "./copy-button";
import { RelativeTime } from "./relative-time";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface UserMessageProps {
  part: SessionMessagePart.TextPart;
}

export const UserMessage = memo(function UserMessage({
  part,
}: UserMessageProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const messageText = part.text;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(messageText);
  };

  useEffect(() => {
    const element = contentRef.current;
    if (!element) {
      return;
    }

    const checkOverflow = () => {
      const previousMaxHeight = element.style.maxHeight;
      const previousOverflow = element.style.overflow;
      element.style.maxHeight = "12rem";
      element.style.overflow = "hidden";
      const isContentOverflowing = element.scrollHeight > element.clientHeight;
      element.style.maxHeight = previousMaxHeight;
      element.style.overflow = previousOverflow;
      setIsOverflowing(isContentOverflowing);
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
      <div className="relative max-w-[80%] rounded-tl-xl rounded-tr rounded-br-xl rounded-bl-xl bg-gradient-to-b from-card to-gray-25 px-4 py-2 text-foreground shadow-sm dark:from-card dark:to-card">
        <Collapsible onOpenChange={setIsExpanded} open={isExpanded}>
          <div
            className={cn(
              isExpanded
                ? "max-h-128 overflow-y-auto"
                : "max-h-54 overflow-hidden", // h-54 ensures the fade lands in the middle of a line
            )}
            ref={contentRef}
          >
            <div className="text-sm break-words whitespace-pre-wrap">
              {messageText}
            </div>
          </div>

          {!isExpanded && isOverflowing && (
            <CollapsibleTrigger asChild>
              <button
                className="absolute inset-0 cursor-pointer"
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

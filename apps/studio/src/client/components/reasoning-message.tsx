import { formatDurationFromDates } from "@/client/lib/format-time";
import { cn } from "@/client/lib/utils";
import { CaretUpIcon } from "@phosphor-icons/react";
import { memo, useEffect, useRef, useState } from "react";
import { useStickToBottom } from "use-stick-to-bottom";

import { PlanningDotIcon } from "./icons/planning-dot";
import { SessionMarkdown } from "./session-markdown";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";

interface ReasoningMessageProps {
  createdAt?: Date;
  endedAt?: Date;
  isLoading?: boolean;
  text: string;
}

export const ReasoningMessage = memo(function ReasoningMessage({
  createdAt,
  endedAt,
  isLoading = false,
  text,
}: ReasoningMessageProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [scrollState, setScrollState] = useState({
    canScrollDown: false,
    canScrollUp: false,
  });
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const duration = formatDurationFromDates(createdAt, endedAt);

  const { contentRef, scrollRef } = useStickToBottom({
    damping: 0.9,
    mass: 2.5,
    stiffness: 0.01,
  });

  const updateScrollState = () => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const { clientHeight, scrollHeight, scrollTop } = container;
    setScrollState({
      canScrollDown: scrollTop < scrollHeight - clientHeight - 1, // -1 for rounding
      canScrollUp: scrollTop > 0,
    });
  };

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    updateScrollState();
    container.addEventListener("scroll", updateScrollState, { passive: true });

    // Also check on content changes
    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(container);

    return () => {
      container.removeEventListener("scroll", updateScrollState);
      resizeObserver.disconnect();
    };
  }, [isExpanded, isLoading, text]);

  const displayText = text.replaceAll("[REDACTED]", "");

  if (!isLoading && !displayText.trim()) {
    return null;
  }

  return (
    <Collapsible
      className={cn(
        "w-full animate-in fill-mode-both fade-in",
        !displayText.trim() && "delay-500",
      )}
      onOpenChange={setIsExpanded}
      open={isExpanded || isLoading}
    >
      <CollapsibleTrigger
        className="flex cursor-default items-center gap-1.5 text-left"
        disabled={!displayText.trim()}
      >
        {isLoading ? (
          <div className="flex items-center gap-2">
            <PlanningDotIcon className="size-3 shrink-0" />
            <span className="shiny-text text-sm font-medium">Planning...</span>
          </div>
        ) : (
          <span className="text-sm text-foreground/40">
            {duration ? `Thought for ${duration}` : "Thought"}
            {isExpanded && <CaretUpIcon className="ml-1 inline size-3" />}
          </span>
        )}
      </CollapsibleTrigger>

      {!(isLoading && !displayText.trim()) && (
        <CollapsibleContent>
          <div className="relative mt-2">
            <div
              className="max-h-44 overflow-y-auto"
              ref={(el) => {
                scrollContainerRef.current = el;
                if (isLoading) {
                  scrollRef.current = el;
                }
              }}
            >
              <SessionMarkdown
                className={cn("italic opacity-50", isLoading && "opacity-100")}
                markdown={
                  isLoading
                    ? displayText
                    : displayText.trim()
                      ? displayText
                      : "Reasoning not available"
                }
                ref={contentRef}
              />
            </div>

            {scrollState.canScrollUp && (
              <div className="pointer-events-none absolute top-0 right-0 left-0 z-10 h-4 bg-linear-to-b from-background to-transparent" />
            )}

            {scrollState.canScrollDown && (
              <div className="pointer-events-none absolute right-0 bottom-0 left-0 z-10 h-4 bg-linear-to-t from-background to-transparent" />
            )}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
});

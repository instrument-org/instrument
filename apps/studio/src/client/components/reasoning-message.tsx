import { formatDuration } from "@/client/lib/format-time";
import { cn } from "@/client/lib/utils";
import { memo, useEffect, useState } from "react";
import { useStickToBottom } from "use-stick-to-bottom";

import { PlanningDotIcon } from "./icons/planning-dot";
import { reasoningDisplayText } from "./reasoning-utils";
import { RunRowChevron } from "./run-row-chevron";
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
  noDelay?: boolean;
  text: string;
}

export const ReasoningMessage = memo(function ReasoningMessage({
  createdAt,
  endedAt,
  isLoading = false,
  noDelay = false,
  text,
}: ReasoningMessageProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [, setTick] = useState(0);

  // Re-render once a second so a running duration counts up. Only while
  // loading: a finished one is fixed, and its end is what it reads against.
  useEffect(() => {
    if (!isLoading) {
      return;
    }
    const interval = setInterval(() => {
      setTick((previous) => previous + 1);
    }, 1000);
    return () => {
      clearInterval(interval);
    };
  }, [isLoading]);

  const { contentRef, scrollRef } = useStickToBottom({
    damping: 0.9,
    mass: 2.5,
    stiffness: 0.01,
  });

  const displayText = reasoningDisplayText(text);
  const hasText = displayText.trim() !== "";

  if (!isLoading && !hasText) {
    return null;
  }

  // Anything under a second reads as having taken a moment either way, so the
  // duration floors at one rather than reporting milliseconds. A finished row
  // measures to its end; a running one measures to now, and the timer above is
  // what makes it climb.
  const endsAt = endedAt ?? (isLoading ? new Date() : undefined);
  const hasTiming = createdAt !== undefined && endsAt !== undefined;
  const elapsedMs = hasTiming ? endsAt.getTime() - createdAt.getTime() : 0;
  const duration = formatDuration(Math.max(elapsedMs, 1000));

  // Without a start time there is no reasoning part behind this row: it is the
  // stand-in the stream shows when the agent is working with nothing to report.
  const label = isLoading
    ? createdAt
      ? `Thinking for ${duration}`
      : "Planning..."
    : hasTiming
      ? `Thought for ${duration}`
      : "Thought";

  return (
    <Collapsible
      className={cn(
        "w-full animate-in fill-mode-both fade-in",
        !hasText && !noDelay && "delay-500",
      )}
      onOpenChange={setIsExpanded}
      open={isExpanded}
    >
      <CollapsibleTrigger
        className="group/run-row flex cursor-default items-center py-1.5 text-left"
        disabled={!hasText}
      >
        <div className="flex h-5 items-center gap-3">
          {isLoading && <PlanningDotIcon className="size-3 shrink-0" />}
          <span
            className={cn(
              "text-sm",
              isLoading
                ? "brand-shiny-text"
                : "text-muted-foreground group-hover/run-row:text-foreground",
            )}
          >
            {label}
          </span>
          {hasText && <RunRowChevron isOpen={isExpanded} />}
        </div>
      </CollapsibleTrigger>

      {hasText && (
        <CollapsibleContent animated>
          <div className="mt-2">
            <div
              className="max-h-44 overflow-y-auto scroll-fade-y"
              ref={(el) => {
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
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
});

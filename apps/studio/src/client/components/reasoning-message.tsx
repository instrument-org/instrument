import { formatDuration } from "@/client/lib/format-time";
import { cn } from "@/client/lib/utils";
import { memo, useEffect, useState } from "react";
import { useStickToBottom } from "use-stick-to-bottom";

import { PlanningDotIcon } from "./icons/planning-dot";
import { useTranscriptGroup } from "./message-part/transcript-group";
import { reasoningDisplayText } from "./reasoning-utils";
import { RunRowChevron } from "./run-row-chevron";
import { SessionMarkdown } from "./session-markdown";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";

interface ReasoningMessageProps {
  createdAt: Date;
  endedAt?: Date;
  isLoading?: boolean;
  /**
   * This row is a group's copy of the step in flight, so it is not arriving in
   * the transcript: the slot is already on screen and already occupied. It draws
   * at once and plain -- waiting would collapse the row and put it straight
   * back, and fading in reads as the line blinking out and returning.
   */
  isStandIn?: boolean;
  text: string;
}

export const ReasoningMessage = memo(function ReasoningMessage({
  createdAt,
  endedAt,
  isLoading = false,
  isStandIn = false,
  text,
}: ReasoningMessageProps) {
  const group = useTranscriptGroup();
  const [isExpanded, setIsExpanded] = useState(false);

  // As a group's head line the row's click opens and shuts the group rather
  // than this row's own reasoning; see `TranscriptGroup`.
  const groupHead = group?.isHead === true && group.canExpand ? group : null;
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
  const elapsedMs = endsAt ? endsAt.getTime() - createdAt.getTime() : 0;
  const duration = formatDuration(Math.max(elapsedMs, 1000));

  const label = isLoading
    ? `Thinking for ${duration}`
    : endsAt
      ? `Thought for ${duration}`
      : "Thought";

  // Only the head line of a group carries the live indicator, so there is one
  // thing moving per group; see `TranscriptGroup`.
  const isFocused = isLoading && (group === null || group.isHead);

  return (
    <Collapsible
      className={cn(
        "w-full",
        !isStandIn && "animate-in fill-mode-both fade-in",
        !isStandIn && !hasText && "delay-500",
      )}
      onOpenChange={groupHead === null ? setIsExpanded : groupHead.toggle}
      open={groupHead === null ? isExpanded : groupHead.isExpanded}
    >
      <CollapsibleTrigger
        className="group/run-row flex cursor-default items-center py-1 text-left"
        disabled={groupHead === null && !hasText}
      >
        <div className="flex h-5 items-center gap-2">
          {isFocused && <PlanningDotIcon />}
          <span
            className={cn(
              "text-sm",
              isFocused
                ? "brand-shiny-text"
                : "text-muted-foreground group-hover/run-row:text-foreground",
            )}
          >
            {label}
          </span>
          {(hasText || groupHead !== null) && (
            <RunRowChevron
              isOpen={groupHead === null ? isExpanded : groupHead.isExpanded}
            />
          )}
        </div>
      </CollapsibleTrigger>

      {hasText && groupHead === null && (
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

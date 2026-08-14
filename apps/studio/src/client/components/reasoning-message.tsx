import { formatDuration } from "@/client/lib/format-time";
import { cn } from "@/client/lib/utils";
import { type StoreId } from "@instrument-org/workspace/client";
import { memo, useEffect, useState } from "react";
import { useStickToBottom } from "use-stick-to-bottom";

import {
  TRANSCRIPT_ROW,
  useTranscriptGroup,
} from "./message-part/transcript-group";
import { PlanningDotSlot } from "./planning-dot-slot";
import { reasoningDisplayText } from "./reasoning-utils";
import { RunRowChevron } from "./run-row-chevron";
import { SessionMarkdown } from "./session-markdown";
import { useRowExpansion } from "./transcript-expansion";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";

// How long a thought has to run before the row starts counting it up. Short
// enough that a wait worth noticing is still reported, long enough that the
// ordinary ones never put a number on screen at all.
const COUNT_UP_AFTER_MS = 3000;

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
  /**
   * The part it draws, which is where its open state is kept; see
   * `useRowExpansion`. Absent outside a transcript, where it keeps its own.
   */
  rowId?: StoreId.Part;
  text: string;
}

export const ReasoningMessage = memo(function ReasoningMessage({
  createdAt,
  endedAt,
  isLoading = false,
  isStandIn = false,
  rowId,
  text,
}: ReasoningMessageProps) {
  const group = useTranscriptGroup();
  const { isExpanded, setIsExpanded } = useRowExpansion(rowId);

  // As a group's head line the row's click opens and shuts the group rather
  // than this row's own reasoning, and the thought itself is drawn by the row
  // in the run rather than twice; see `TranscriptGroup`.
  const groupHead =
    group?.isHead === true && (group.canExpand || group.isExpanded)
      ? group
      : null;

  // The clock a running duration reads against, held as state and advanced once
  // a second. Reading it during render instead would leave the row's output no
  // longer a function of its inputs, and memoization would then serve the same
  // instant back forever while the row claims to be counting.
  const [now, setNow] = useState(() => Date.now());

  // Only while loading: a finished thought is fixed, and its end is what it
  // reads against.
  useEffect(() => {
    if (!isLoading) {
      return;
    }
    setNow(Date.now());
    const interval = setInterval(() => {
      setNow(Date.now());
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
  const endsAtMs = endedAt?.getTime() ?? (isLoading ? now : undefined);
  const elapsedMs = endsAtMs === undefined ? 0 : endsAtMs - createdAt.getTime();
  const duration = formatDuration(Math.max(elapsedMs, 1000));

  // A clock on a row that is still going invites the reader to watch it, and for
  // the first few seconds there is nothing to watch: every thought passes
  // through one second and two on its way to wherever it ends up. So the count
  // waits until the wait is worth remarking on, and until then the row says only
  // that the agent is thinking. A finished row reports whatever it took, one
  // second included -- there the number is the answer rather than a ticker.
  const label = isLoading
    ? elapsedMs < COUNT_UP_AFTER_MS
      ? "Thinking"
      : `Thinking for ${duration}`
    : endsAtMs === undefined
      ? "Thought"
      : `Thought for ${duration}`;

  // Only the head line of a group carries the live indicator, so there is one
  // thing moving per group; see `TranscriptGroup`.
  const showsLiveIndicator = isLoading && (group === null || group.isHead);

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
        className={cn(TRANSCRIPT_ROW, "cursor-default text-left")}
        disabled={groupHead === null && !hasText}
      >
        <PlanningDotSlot isRunning={showsLiveIndicator} />
        <span
          className={cn(
            "text-sm",
            showsLiveIndicator
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

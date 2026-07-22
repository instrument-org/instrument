import { formatDurationFromDates } from "@/client/lib/format-time";
import { cn } from "@/client/lib/utils";
import { CaretUpIcon } from "@phosphor-icons/react";
import { memo, useState } from "react";
import { useStickToBottom } from "use-stick-to-bottom";

import { PlanningDotIcon } from "./icons/planning-dot";
import { reasoningDisplayText } from "./reasoning-utils";
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

  const duration = formatDurationFromDates(createdAt, endedAt);

  const { contentRef, scrollRef } = useStickToBottom({
    damping: 0.9,
    mass: 2.5,
    stiffness: 0.01,
  });

  const displayText = reasoningDisplayText(text);

  if (!isLoading && !displayText.trim()) {
    return null;
  }

  return (
    <Collapsible
      className={cn(
        "w-full animate-in fill-mode-both fade-in",
        !displayText.trim() && !noDelay && "delay-500",
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

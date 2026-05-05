import {
  getToolNameByType,
  type SessionMessagePart,
} from "@instrument-org/workspace/client";
import { useState } from "react";

import { getToolExplanation } from "../../lib/get-tool-explanation";
import {
  getToolLabelForPart,
  getToolStreamingLabel,
  TOOL_ICONS,
} from "../../lib/tool-display";
import { cn } from "../../lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { Spinner } from "../ui/spinner";

export function ToolCallHeader({
  expandedContent,
  isStreaming,
  part,
  valueChip,
}: {
  expandedContent?: React.ReactNode;
  isStreaming: boolean;
  part: SessionMessagePart.ToolPart;
  /**
   * Short value shown as a secondary pill after the label (filename, count, etc.).
   */
  valueChip?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const toolName = getToolNameByType(part.type);
  const Icon = TOOL_ICONS[toolName];

  const isFileNotFound =
    part.state === "output-available" &&
    part.type === "tool-read_file" &&
    part.output.state === "does-not-exist";
  const isError = part.state === "output-error" || isFileNotFound;
  const hasCapabilityFailure =
    part.state === "output-available" &&
    (part.type === "tool-web_search" || part.type === "tool-generate_image") &&
    part.output.state === "failure";
  const isFailed = isError || hasCapabilityFailure;
  const isExpandable = !isStreaming;

  const explanation = getToolExplanation(part);

  const label =
    explanation ??
    (isStreaming
      ? getToolStreamingLabel(toolName)
      : getToolLabelForPart({
          hasCapabilityFailure,
          part,
          state: isFailed ? "failed" : "completed",
          toolName,
        }));

  const trigger = (
    <div
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-3 rounded-full border py-2 pr-4 pl-3 transition-colors",
        isOpen ? "border-foreground/5 bg-accent" : "border-border bg-card",
      )}
    >
      {isStreaming ? (
        <Spinner className="size-3 shrink-0 text-foreground/60" />
      ) : (
        Icon && (
          <span className="flex shrink-0 items-center rounded-lg bg-foreground/5 p-1">
            <Icon className="size-3 text-foreground/70" />
          </span>
        )
      )}

      <span
        className={cn(
          "min-w-0 truncate text-sm leading-4 text-foreground",
          isStreaming && "shiny-text",
        )}
      >
        {label}
      </span>

      {!isStreaming && valueChip && (
        <span className="ml-1 shrink-0 rounded-full bg-foreground/5 px-2 pb-0.5 text-xs font-medium text-foreground/50">
          {valueChip}
        </span>
      )}
    </div>
  );

  if (!isExpandable) {
    return trigger;
  }

  return (
    <Collapsible onOpenChange={setIsOpen} open={isOpen}>
      <CollapsibleTrigger asChild>{trigger}</CollapsibleTrigger>
      <CollapsibleContent>{expandedContent}</CollapsibleContent>
    </Collapsible>
  );
}

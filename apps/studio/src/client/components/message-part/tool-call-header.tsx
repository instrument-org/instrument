import {
  getToolNameByType,
  type SessionMessagePart,
} from "@instrument-org/workspace/client";
import { GlobeIcon, type Icon } from "@phosphor-icons/react";
import { useState } from "react";

import { getToolExplanation } from "../../lib/get-tool-explanation";
import {
  getToolLabelForPart,
  getToolStreamingLabel,
  TOOL_ICONS,
} from "../../lib/tool-display";
import { cn } from "../../lib/utils";
import { Favicon } from "../favicon";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { Spinner } from "../ui/spinner";

interface BrowserInfo {
  /** Sorted by visit count, descending. */
  domains: string[];
}

export function ToolCallHeader({
  expandedContent,
  isAgentRunning,
  isStreaming,
  part,
}: {
  expandedContent?: React.ReactNode;
  isAgentRunning: boolean;
  isStreaming: boolean;
  part: SessionMessagePart.ToolPart;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isOpen = isExpanded || isStreaming;

  const toolName = getToolNameByType(part.type);
  const browserInfo = getBrowserInfo(part);
  const Icon: Icon | undefined = browserInfo
    ? GlobeIcon
    : (TOOL_ICONS[toolName] ?? undefined);

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

      {!isStreaming && browserInfo && <BrowserChip info={browserInfo} />}
    </div>
  );

  return (
    <Collapsible onOpenChange={setIsExpanded} open={isOpen}>
      <CollapsibleTrigger asChild>{trigger}</CollapsibleTrigger>
      <CollapsibleContent animated={!isAgentRunning}>
        {expandedContent}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ToolChip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "ml-1 flex shrink-0 items-center gap-1.5 rounded-full bg-foreground/5 py-0.5 pr-2.5 pl-1",
        className,
      )}
    >
      {children}
    </span>
  );
}

function BrowserChip({ info }: { info: BrowserInfo }) {
  const topDomain = info.domains[0] ?? "";
  const extra = info.domains.length - 1;

  return (
    <ToolChip>
      <Favicon
        className="size-3.5 border border-muted bg-background"
        url={`https://${topDomain}`}
      />
      <span className="text-xs font-medium text-foreground/50">
        {topDomain}
        {extra > 0 && (
          <span className="text-foreground/30"> & {extra} more</span>
        )}
      </span>
    </ToolChip>
  );
}

function getBrowserInfo(part: SessionMessagePart.ToolPart): BrowserInfo | null {
  if (part.type !== "tool-bash") {
    return null;
  }

  const contextItems =
    "contextItems" in part.metadata ? (part.metadata.contextItems ?? []) : [];
  if (contextItems.length === 0) {
    return null;
  }

  const domainCounts = new Map<string, number>();
  for (const item of contextItems) {
    const urlToken = item.subcommand
      .split(/\s+/)
      .find((t) => t.startsWith("http"));
    if (!urlToken) {
      continue;
    }
    try {
      const hostname = new URL(urlToken).hostname;
      domainCounts.set(hostname, (domainCounts.get(hostname) ?? 0) + 1);
    } catch {
      // not a valid URL
    }
  }

  if (domainCounts.size === 0) {
    return null;
  }

  const domains = [...domainCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([domain]) => domain);

  return { domains };
}

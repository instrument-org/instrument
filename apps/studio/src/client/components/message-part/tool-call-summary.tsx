import {
  getToolNameByType,
  type SessionMessagePart,
} from "@instrument-org/workspace/client";
import { EyeIcon, GlobeIcon, type Icon } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useState } from "react";

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
import { BrowserChip, type BrowserInfo } from "./tool-bash";
import { useToolCallSession } from "./tool-call-session";
import { FileChip } from "./tool-card";
import { SourceImagesChip } from "./tool-generate-image";
import { WebSearchChip } from "./tool-web-search";

export function ToolCallSummary({
  assetBaseUrl,
  children,
  isDeadDevMode = false,
  part,
}: {
  assetBaseUrl: string;
  children?: ReactNode;
  isDeadDevMode?: boolean;
  part: SessionMessagePart.ToolPart;
}) {
  const { isAgentRunning, isStreaming } = useToolCallSession();
  const [isManuallyOpen, setIsManuallyOpen] = useState(false);
  // Debounce both edges of isStreaming to avoid flickering open/closed for
  // tool calls that stream very briefly.
  // - Opening is delayed: only open after streaming has been true for 300ms.
  // - Closing is delayed: stay open for 600ms after streaming ends.
  const [isStreamingDebounced, setIsStreamingDebounced] = useState(false);

  useEffect(() => {
    if (isStreaming) {
      const timer = setTimeout(() => {
        setIsStreamingDebounced(true);
      }, 500);
      return () => {
        clearTimeout(timer);
      };
    }
    const timer = setTimeout(() => {
      setIsStreamingDebounced(false);
    }, 1200);
    return () => {
      clearTimeout(timer);
    };
  }, [isStreaming]);

  const isCollapsibleOpen = isManuallyOpen || isStreamingDebounced;
  const isEmphasized = isCollapsibleOpen && !isStreaming && !isAgentRunning;

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
    !isFailed && explanation
      ? explanation
      : isStreaming
        ? getToolStreamingLabel(toolName)
        : getToolLabelForPart({
            hasCapabilityFailure,
            part,
            state: isFailed ? "failed" : "completed",
            toolName,
          });

  const deadLabel = isDeadDevMode
    ? `${getToolLabelForPart({ part, state: "streaming", toolName })} stopped while ${part.state}`
    : null;

  const trigger = (
    <div
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-3 rounded-full border py-2 pr-4 pl-3 transition-colors",
        isEmphasized
          ? "border-foreground/5 bg-accent"
          : "border-border bg-card",
      )}
    >
      {isDeadDevMode ? (
        <span className="flex shrink-0 items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-500 uppercase">
          <EyeIcon className="size-2.5" />
          Dev
        </span>
      ) : isStreaming ? (
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
        {deadLabel ?? label}
      </span>

      {browserInfo && (
        <BrowserChip info={browserInfo} isEmphasized={isEmphasized} />
      )}
      <WebSearchChip isEmphasized={isEmphasized} part={part} />
      <SourceImagesChip
        assetBaseUrl={assetBaseUrl}
        isEmphasized={isEmphasized}
        part={part}
      />
      <FileChip isEmphasized={isEmphasized} part={part} />
    </div>
  );

  return (
    <Collapsible onOpenChange={setIsManuallyOpen} open={isCollapsibleOpen}>
      <CollapsibleTrigger asChild>{trigger}</CollapsibleTrigger>
      <CollapsibleContent animated>{children}</CollapsibleContent>
    </Collapsible>
  );
}

function getBrowserInfo(part: SessionMessagePart.ToolPart): BrowserInfo | null {
  if (part.type !== "tool-bash") {
    return null;
  }

  const contextItems = part.metadata.contextItems ?? [];
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
      const hostname = new URL(urlToken).hostname.replace(/^www\./, "");
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

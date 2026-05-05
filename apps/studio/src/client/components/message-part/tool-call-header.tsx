import {
  getToolNameByType,
  type SessionMessagePart,
} from "@instrument-org/workspace/client";
import { GlobeIcon, type Icon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { getToolExplanation } from "../../lib/get-tool-explanation";
import { filenameFromFilePath } from "../../lib/path-utils";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

interface BrowserInfo {
  /** Sorted by visit count, descending. */
  domains: string[];
}

export function ToolCallHeader({
  assetBaseUrl,
  expandedContent,
  isAgentRunning,
  isStreaming,
  part,
}: {
  assetBaseUrl: string;
  expandedContent?: React.ReactNode;
  isAgentRunning: boolean;
  isStreaming: boolean;
  part: SessionMessagePart.ToolPart;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
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

  const isOpen = isExpanded || isStreamingDebounced;
  // Visual "selected" state: open but not actively streaming or running.
  const isSelected = isOpen && !isStreaming && !isAgentRunning;

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
        isSelected ? "border-foreground/5 bg-accent" : "border-border bg-card",
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

      {browserInfo && (
        <BrowserChip info={browserInfo} isSelected={isSelected} />
      )}
      <WebSearchChip isSelected={isSelected} part={part} />
      <SourceImagesChip
        assetBaseUrl={assetBaseUrl}
        isSelected={isSelected}
        part={part}
      />
      <FileChip isSelected={isSelected} part={part} />
    </div>
  );

  return (
    <Collapsible onOpenChange={setIsExpanded} open={isOpen}>
      <CollapsibleTrigger asChild>{trigger}</CollapsibleTrigger>
      <CollapsibleContent animated>{expandedContent}</CollapsibleContent>
    </Collapsible>
  );
}

function BrowserChip({
  info,
  isSelected,
}: {
  info: BrowserInfo;
  isSelected: boolean;
}) {
  const topDomain = info.domains[0] ?? "";
  const extra = info.domains.length - 1;

  return (
    <ToolChip isSelected={isSelected}>
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

function FileChip({
  isSelected,
  part,
}: {
  isSelected: boolean;
  part: SessionMessagePart.ToolPart;
}) {
  let filePath: string | undefined;

  if (
    (part.type === "tool-edit_file" ||
      part.type === "tool-write_file" ||
      part.type === "tool-read_file") &&
    // typeof guard is intentional: the AI SDK types DeepPartial<string> as
    // string during streaming, but parsePartialJson can produce null mid-stream.
    typeof part.input?.filePath === "string" &&
    part.input.filePath.length > 0
  ) {
    filePath = part.input.filePath;
  }

  if (!filePath) {
    return null;
  }

  const filename = filenameFromFilePath(filePath);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ToolChip className="px-2" isSelected={isSelected}>
          <span className="text-xs font-medium text-foreground/50">
            {filename}
          </span>
        </ToolChip>
      </TooltipTrigger>
      <TooltipContent>{filePath}</TooltipContent>
    </Tooltip>
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

function SourceImagesChip({
  assetBaseUrl,
  isSelected,
  part,
}: {
  assetBaseUrl: string;
  isSelected: boolean;
  part: SessionMessagePart.ToolPart;
}) {
  if (part.type !== "tool-generate_image") {
    return null;
  }

  const sourceImages = (part.input?.sourceImages ?? []).filter(
    (s): s is string => typeof s === "string",
  );

  if (sourceImages.length === 0) {
    return null;
  }

  return (
    <ToolChip className="gap-0 px-1" isSelected={isSelected}>
      {sourceImages.slice(0, 3).map((filePath, index) => {
        const src = `${assetBaseUrl}/${filePath.startsWith("./") ? filePath.slice(2) : filePath}`;
        return (
          <img
            alt="Reference"
            className="-ml-0.5 size-4 rounded-full border border-border/50 object-cover first:ml-0"
            key={index}
            src={src}
          />
        );
      })}
      {sourceImages.length > 3 && (
        <span className="ml-1 text-xs text-foreground/40">
          +{sourceImages.length - 3}
        </span>
      )}
    </ToolChip>
  );
}

function ToolChip({
  children,
  className,
  isSelected,
}: {
  children: React.ReactNode;
  className?: string;
  isSelected?: boolean;
}) {
  return (
    <span
      className={cn(
        "ml-1 flex shrink-0 items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-1",
        isSelected ? "bg-foreground/10" : "bg-foreground/5",
        className,
      )}
    >
      {children}
    </span>
  );
}

function WebSearchChip({
  isSelected,
  part,
}: {
  isSelected: boolean;
  part: SessionMessagePart.ToolPart;
}) {
  if (
    part.type !== "tool-web_search" ||
    part.state !== "output-available" ||
    part.output.state !== "success" ||
    part.output.sources.length === 0
  ) {
    return null;
  }

  const uniqueUrls = [
    ...new Map(
      part.output.sources.map((s) => {
        const hostname = URL.canParse(s.url) ? new URL(s.url).hostname : s.url;
        return [hostname, s.url];
      }),
    ).values(),
  ].slice(0, 5);

  return (
    <ToolChip className="gap-0 px-1" isSelected={isSelected}>
      {uniqueUrls.map((url, index) => (
        <Favicon
          className="-ml-0.5 size-3.5 border border-muted bg-background first:ml-0"
          key={index}
          url={url}
        />
      ))}
    </ToolChip>
  );
}

import type {
  ProjectSubdomain,
  SessionMessagePart,
} from "@instrument-org/workspace/client";

import { useSetAtom } from "jotai";
import {
  ChevronDown,
  Copy,
  Loader2Icon,
  MessageSquare,
  Terminal,
} from "lucide-react";
import { useMemo, useState } from "react";

import { openFileViewerAtom } from "../../atoms/project-file-viewer";
import { appendToPromptAtom } from "../../atoms/prompt-value";
import { getAssetUrl } from "../../lib/get-asset-url";
import { cn } from "../../lib/utils";
import { ConfirmedIconButton } from "../confirmed-icon-button";
import { Favicon } from "../favicon";
import { ImageWithFallback } from "../image-with-fallback";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { ToolCard, ToolCardHeader } from "./tool-card";
import { VirtualizedScrollingText } from "./virtualized-scrolling-text";

type BrowserScreenshot = Extract<
  SessionMessagePart.ToolPartContextItem,
  { kind: "agent-browser-screenshot" }
>;

type ShellCommandPart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-bash" }
>;

export function ShellCommandCard({
  assetBaseUrl,
  isLoading,
  part,
  projectSubdomain,
}: {
  assetBaseUrl: string;
  isLoading: boolean;
  part: ShellCommandPart;
  projectSubdomain: ProjectSubdomain;
}) {
  const appendToPrompt = useSetAtom(appendToPromptAtom);
  const [isExpanded, setIsExpanded] = useState(false);

  if (!part.input) {
    return null;
  }

  const command = part.input.command || "";
  const parts: string[] = [`$ ${command}`];

  const hasOutput = part.state === "output-available";
  const isError = part.state === "output-error";

  if (hasOutput) {
    if (part.output.output) {
      parts.push(part.output.output);
    }
  } else if (isError) {
    parts.push(`Error: ${part.errorText || "Command failed"}`);
  }

  const content = parts.join("\n");

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
  };

  const handleSendToChat = () => {
    appendToPrompt({
      key: projectSubdomain,
      update: (prev) => (prev ? `${prev}\n\n${content}` : content),
    });
  };

  const hasError = isError || (hasOutput && part.output.exitCode !== 0);
  const reasoning = part.input.explanation;
  const hasContent = hasOutput || isError;
  const showContent = isExpanded || isLoading;

  const contextItems =
    "contextItems" in part.metadata ? (part.metadata.contextItems ?? []) : [];
  // Currently the only context item kind is screenshots; this filter exists
  // for future-proofing as we add more polymorphic context item kinds.
  const screenshots: BrowserScreenshot[] = contextItems.flatMap((item) =>
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    item.kind === "agent-browser-screenshot" ? [item] : [],
  );

  return (
    <ToolCard>
      <ToolCardHeader
        className={cn(
          hasContent && "cursor-pointer select-none",
          !showContent && "border-b-0",
        )}
        onClick={
          hasContent
            ? () => {
                setIsExpanded((v) => !v);
              }
            : undefined
        }
      >
        <span className="relative size-3 shrink-0">
          {isLoading ? (
            <Loader2Icon className="size-3 animate-spin text-accent-foreground/80" />
          ) : (
            <>
              <Terminal className="size-3 text-muted-foreground transition-opacity group-hover:opacity-0" />
              <ChevronDown
                className={cn(
                  "absolute inset-0 size-3 text-muted-foreground opacity-0 transition-[opacity,transform] group-hover:opacity-100",
                  isExpanded && "rotate-180",
                )}
              />
            </>
          )}
        </span>
        {hasError && (
          <span className="shrink-0 text-muted-foreground">Error</span>
        )}
        <span className="min-w-0 truncate text-foreground/80">
          {reasoning ?? command}
        </span>
        {hasOutput && part.output.commands.length > 0 && (
          <span className="shrink-0 text-xs text-muted-foreground/60">
            {part.output.commands.join(", ")}
          </span>
        )}
      </ToolCardHeader>

      {screenshots.length > 0 && (
        <BrowserScreenshotStrip
          assetBaseUrl={assetBaseUrl}
          projectSubdomain={projectSubdomain}
          screenshots={screenshots}
        />
      )}

      {showContent && (
        <>
          <div className="max-h-32 overflow-y-auto border-b border-border/50 bg-muted/40 px-3 py-1.5">
            <pre className="font-mono text-xs leading-[1.4] whitespace-pre-wrap text-foreground/90">
              <span className="mr-1.5 text-muted-foreground select-none">
                $
              </span>
              {command}
            </pre>
          </div>
          <VirtualizedScrollingText
            autoScrollToBottom={isLoading}
            content={hasOutput || isError ? parts.slice(1).join("\n") : ""}
          />
        </>
      )}

      {!isLoading && projectSubdomain && isExpanded && (
        <div className="absolute top-8 right-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <ConfirmedIconButton
            className="size-5 border border-border/50 bg-muted hover:bg-accent!"
            icon={MessageSquare}
            onClick={handleSendToChat}
            successTooltip="Sent to chat!"
            tooltip="Send to chat"
            variant="ghost"
          />
          <ConfirmedIconButton
            className="size-5 border border-border/50 bg-muted hover:bg-accent!"
            icon={Copy}
            onClick={handleCopy}
            successTooltip="Copied!"
            tooltip="Copy"
            variant="ghost"
          />
        </div>
      )}
    </ToolCard>
  );
}

function BrowserScreenshotStrip({
  assetBaseUrl,
  projectSubdomain,
  screenshots,
}: {
  assetBaseUrl: string;
  projectSubdomain: ProjectSubdomain;
  screenshots: BrowserScreenshot[];
}) {
  const openFileViewer = useSetAtom(openFileViewerAtom);

  const items = useMemo(
    () =>
      screenshots.map((shot) => ({
        ...shot,
        assetUrl: getAssetUrl({
          assetBase: assetBaseUrl,
          filePath: shot.screenshotPath,
        }),
        filename: shot.screenshotPath.split("/").pop() ?? shot.screenshotPath,
      })),
    [assetBaseUrl, screenshots],
  );

  const handleClick = (index: number) => {
    openFileViewer({
      currentIndex: index,
      files: items.map((item) => ({
        filename: item.filename,
        filePath: item.screenshotPath,
        mimeType: "image/png",
        projectSubdomain,
        url: item.assetUrl,
      })),
    });
  };

  return (
    <div className="flex gap-2 overflow-x-auto border-b border-border/50 bg-muted/40 p-2">
      {items.map((item, index) => {
        const tooltipLabel = item.title
          ? `${item.title} - ${item.url}`
          : item.url;
        return (
          <Tooltip key={`${item.screenshotPath}-${index}`}>
            <TooltipTrigger asChild>
              <button
                aria-label={`Open screenshot for ${tooltipLabel}`}
                className="block w-32 shrink-0 overflow-hidden rounded-sm border border-border/50 bg-background transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  handleClick(index);
                }}
                type="button"
              >
                <div className="flex items-center gap-1 border-b border-border/50 bg-muted/60 px-1.5 py-1">
                  <Favicon className="size-3" url={item.url} />
                  <span className="min-w-0 flex-1 truncate text-left text-[10px] leading-tight text-foreground/80">
                    {item.title || item.url}
                  </span>
                </div>
                <ImageWithFallback
                  alt={item.title || item.url}
                  className="h-20 w-32 object-cover"
                  fallbackClassName="h-20 w-32"
                  filename={item.filename}
                  src={item.assetUrl}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[min(500px,90vw)] wrap-break-word">
              {item.title ? (
                <div className="flex flex-col gap-0.5">
                  <span>{item.title}</span>
                  <span className="text-muted-foreground">{item.url}</span>
                </div>
              ) : (
                <span>{item.url}</span>
              )}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

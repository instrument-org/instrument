import type {
  ProjectSubdomain,
  SessionMessagePart,
} from "@instrument-org/workspace/client";

import { useSetAtom } from "jotai";
import {
  AlertCircle,
  ChevronDown,
  Copy,
  Loader2Icon,
  MessageSquare,
  Terminal,
} from "lucide-react";
import { useState } from "react";

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

type BrowserCommandObservation = Extract<
  SessionMessagePart.ToolPartContextItem,
  { kind: "agent-browser-command" }
>;
type BrowserScreenshot = SessionMessagePart.AgentBrowserScreenshot;

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
  // Currently the only context item kind is browser observations; this
  // filter exists for future-proofing as we add more polymorphic context
  // item kinds.
  const browserObservations: BrowserCommandObservation[] = contextItems.flatMap(
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    (item) => (item.kind === "agent-browser-command" ? [item] : []),
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

      {browserObservations.length > 0 && (
        <BrowserScreenshotStrip
          assetBaseUrl={assetBaseUrl}
          observations={browserObservations}
          projectSubdomain={projectSubdomain}
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
  observations,
  projectSubdomain,
}: {
  assetBaseUrl: string;
  observations: BrowserCommandObservation[];
  projectSubdomain: ProjectSubdomain;
}) {
  const openFileViewer = useSetAtom(openFileViewerAtom);

  // Flatten all screenshots across observations into the file-viewer list
  // so the prev/next arrows traverse them in order. Each individual
  // thumbnail clicks open at its own index.
  const viewerFiles = observations.flatMap((obs) => {
    const shots: BrowserScreenshot[] = [obs.startScreenshot];
    if (obs.status === "complete" && obs.endScreenshot) {
      shots.push(obs.endScreenshot);
    }
    return shots.map((s) => ({
      filename: s.path.split("/").pop() ?? s.path,
      filePath: s.path,
      mimeType: "image/png" as const,
      projectSubdomain,
      url: getAssetUrl({ assetBase: assetBaseUrl, filePath: s.path }),
    }));
  });

  const openViewerFor = (filePath: string) => {
    const currentIndex = viewerFiles.findIndex((f) => f.filePath === filePath);
    if (currentIndex === -1) {
      return;
    }
    openFileViewer({ currentIndex, files: viewerFiles });
  };

  return (
    <div className="flex gap-3 overflow-x-auto border-b border-border/50 bg-muted/40 p-2">
      {observations.map((obs) => (
        <ObservationCard
          assetBaseUrl={assetBaseUrl}
          key={obs.id}
          observation={obs}
          onOpenViewer={openViewerFor}
        />
      ))}
    </div>
  );
}

function ObservationCard({
  assetBaseUrl,
  observation,
  onOpenViewer,
}: {
  assetBaseUrl: string;
  observation: BrowserCommandObservation;
  onOpenViewer: (filePath: string) => void;
}) {
  const isPending = observation.status === "pending";
  const error =
    observation.status === "complete" ? observation.error : undefined;
  const endScreenshot =
    observation.status === "complete" ? observation.endScreenshot : undefined;
  const samePath =
    !!endScreenshot && endScreenshot.path === observation.startScreenshot.path;

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <ScreenshotThumbnail
        assetBaseUrl={assetBaseUrl}
        command={observation.subcommand}
        label="before"
        onClick={() => {
          onOpenViewer(observation.startScreenshot.path);
        }}
        screenshot={observation.startScreenshot}
      />
      {samePath ? (
        <span className="px-1 text-[10px] text-muted-foreground italic">
          no change
        </span>
      ) : (
        <ChevronDown className="size-3 -rotate-90 text-muted-foreground/60" />
      )}
      {renderEndSlot({
        assetBaseUrl,
        command: observation.subcommand,
        endScreenshot,
        error,
        isPending,
        onOpenViewer,
        samePath,
      })}
    </div>
  );
}

function PlaceholderThumbnail({
  kind,
  tooltip,
}: {
  kind: "error" | "pending";
  tooltip?: string;
}) {
  const content = (
    <div
      className={cn(
        "flex h-20 w-32 items-center justify-center rounded-sm border bg-muted/40",
        kind === "error" ? "border-destructive/60" : "border-border/50",
      )}
    >
      {kind === "pending" ? (
        <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
      ) : (
        <AlertCircle className="size-4 text-destructive" />
      )}
    </div>
  );
  if (!tooltip) {
    return content;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent className="max-w-[min(500px,90vw)] wrap-break-word">
        <span className="text-destructive">{tooltip}</span>
      </TooltipContent>
    </Tooltip>
  );
}

function renderEndSlot({
  assetBaseUrl,
  command,
  endScreenshot,
  error,
  isPending,
  onOpenViewer,
  samePath,
}: {
  assetBaseUrl: string;
  command: string;
  endScreenshot: BrowserScreenshot | undefined;
  error: string | undefined;
  isPending: boolean;
  onOpenViewer: (filePath: string) => void;
  samePath: boolean;
}) {
  if (isPending) {
    return <PlaceholderThumbnail kind="pending" />;
  }
  if (endScreenshot && samePath) {
    return null;
  }
  if (endScreenshot) {
    return (
      <ScreenshotThumbnail
        assetBaseUrl={assetBaseUrl}
        command={command}
        label="after"
        onClick={() => {
          onOpenViewer(endScreenshot.path);
        }}
        screenshot={endScreenshot}
      />
    );
  }
  return <PlaceholderThumbnail kind="error" tooltip={error} />;
}

function ScreenshotThumbnail({
  assetBaseUrl,
  command,
  label,
  onClick,
  screenshot,
}: {
  assetBaseUrl: string;
  command: string;
  label: string;
  onClick: () => void;
  screenshot: BrowserScreenshot;
}) {
  const assetUrl = getAssetUrl({
    assetBase: assetBaseUrl,
    filePath: screenshot.path,
  });
  const filename = screenshot.path.split("/").pop() ?? screenshot.path;
  const headerLabel = screenshot.title || screenshot.url;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={`Open ${label} screenshot for ${command}`}
          className="block w-32 shrink-0 overflow-hidden rounded-sm border border-border/50 bg-background transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onClick}
          type="button"
        >
          <div className="flex items-center gap-1 border-b border-border/50 bg-muted/60 px-1.5 py-1">
            <Favicon className="size-3" url={screenshot.url} />
            <span className="min-w-0 flex-1 truncate text-left text-[10px] leading-tight text-foreground/80">
              {headerLabel}
            </span>
          </div>
          <ImageWithFallback
            alt={headerLabel}
            className="h-20 w-32 object-cover"
            fallbackClassName="h-20 w-32"
            filename={filename}
            src={assetUrl}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[min(500px,90vw)] wrap-break-word">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-xs">{command}</span>
          <span className="text-muted-foreground">{label}</span>
          {screenshot.title ? <span>{screenshot.title}</span> : null}
          <span className="text-muted-foreground">{screenshot.url}</span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

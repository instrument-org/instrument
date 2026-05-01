import type {
  ProjectSubdomain,
  SessionMessagePart,
} from "@instrument-org/workspace/client";

import {
  CaretDownIcon,
  ChatTextIcon,
  CopyIcon,
  TerminalIcon,
} from "@phosphor-icons/react";
import { useSetAtom } from "jotai";
import { useState } from "react";

import { appendToPromptAtom } from "../../atoms/prompt-value";
import { cn } from "../../lib/utils";
import { ConfirmedIconButton } from "../confirmed-icon-button";
import { Spinner } from "../ui/spinner";
import { AgentBrowserPlayer } from "./agent-browser-player";
import { ToolCard, ToolCardHeader } from "./tool-card";
import { VirtualizedScrollingText } from "./virtualized-scrolling-text";

type BrowserCommandObservation = Extract<
  SessionMessagePart.ToolPartContextItem,
  { kind: "agent-browser-command" }
>;

type ShellCommandPart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-bash" }
>;

export function ShellCommandCard({
  assetBaseUrl,
  isStreaming,
  part,
  projectSubdomain,
}: {
  assetBaseUrl: string;
  isStreaming: boolean;
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

  const outputTrimmed = hasOutput ? part.output.output.trim() : "";
  const content =
    hasOutput && outputTrimmed.length === 0
      ? `${parts[0] ?? ""}\n(no output)`
      : parts.join("\n");

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
  const showContent = isExpanded || isStreaming;
  const showNoOutputHint =
    showContent && !isStreaming && hasOutput && outputTrimmed.length === 0;

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
          {isStreaming ? (
            <Spinner className="size-3 text-accent-foreground/80" />
          ) : (
            <>
              <TerminalIcon className="size-3 text-muted-foreground transition-opacity group-hover:opacity-0" />
              <CaretDownIcon
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

      {showContent && (
        <>
          {browserObservations.length > 0 && (
            <AgentBrowserPlayer
              assetBaseUrl={assetBaseUrl}
              isStreaming={isStreaming}
              observations={browserObservations}
            />
          )}
          <div className="max-h-32 overflow-y-auto border-b border-border/50 bg-muted/40 px-3 py-1.5">
            <pre className="font-mono text-xs leading-[1.4] whitespace-pre-wrap text-foreground/90">
              <span className="mr-1.5 text-muted-foreground select-none">
                $
              </span>
              {command}
            </pre>
            {showNoOutputHint && (
              <p className="mt-1 font-mono text-xs text-muted-foreground/80 italic">
                No output
              </p>
            )}
          </div>
          <VirtualizedScrollingText
            autoScrollToBottom={isStreaming}
            content={hasOutput || isError ? parts.slice(1).join("\n") : ""}
          />
        </>
      )}

      {!isStreaming && projectSubdomain && isExpanded && (
        <div className="absolute top-8 right-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <ConfirmedIconButton
            className="size-5 border border-border/50 bg-muted hover:bg-accent!"
            icon={ChatTextIcon}
            onClick={handleSendToChat}
            successTooltip="Sent to chat!"
            tooltip="Send to chat"
            variant="ghost"
          />
          <ConfirmedIconButton
            className="size-5 border border-border/50 bg-muted hover:bg-accent!"
            icon={CopyIcon}
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

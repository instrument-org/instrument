import { type SessionMessagePart } from "@instrument-org/workspace/client";

import { useSyntaxHighlighting } from "../../hooks/use-syntax-highlighting";
import { getToolLabel } from "../../lib/tool-display";
import { cn } from "../../lib/utils";
import { Favicon } from "../favicon";
import { AgentBrowserPlayer } from "../tool-part/agent-browser-player";
import { useToolCallSession } from "./tool-call-session";
import {
  ToolCard,
  ToolCardHeader,
  ToolCardSection,
  ToolChip,
} from "./tool-card";

export interface BrowserInfo {
  /** Sorted by visit count, descending. */
  domains: string[];
}
type BashPart = Extract<SessionMessagePart.ToolPart, { type: "tool-bash" }>;

type BrowserCommandObservation = Extract<
  SessionMessagePart.ToolPartContextItem,
  { kind: "agent-browser-command" }
>;

const MAX_BASH_COMMAND_CHIPS = 3;

export function BashCommandChip({
  commands,
  isEmphasized,
}: {
  commands: string[];
  isEmphasized: boolean;
}) {
  if (commands.length === 0) {
    return null;
  }
  const visible = commands.slice(0, MAX_BASH_COMMAND_CHIPS);
  const extra = commands.length - visible.length;
  return (
    <ToolChip
      className="max-w-[10rem] gap-1 px-1.5"
      isEmphasized={isEmphasized}
    >
      <span className="truncate font-mono text-xs text-foreground/50">
        {visible.join(", ")}
      </span>
      {extra > 0 && (
        <span className="shrink-0 text-xs text-foreground/30">+{extra}</span>
      )}
    </ToolChip>
  );
}

export function BrowserChip({
  info,
  isEmphasized,
}: {
  info: BrowserInfo;
  isEmphasized: boolean;
}) {
  const topDomain = info.domains[0] ?? "";
  const extra = info.domains.length - 1;

  return (
    <ToolChip className="max-w-[12rem]" isEmphasized={isEmphasized}>
      <Favicon
        className="size-3.5 border border-muted bg-background"
        url={`https://${topDomain}`}
      />
      <span className="truncate text-xs font-medium text-foreground/50">
        {topDomain}
        {extra > 0 && (
          <span className="text-foreground/30"> & {extra} more</span>
        )}
      </span>
    </ToolChip>
  );
}

export function ToolBash({
  assetBaseUrl,
  part,
}: {
  assetBaseUrl: string;
  part: BashPart;
}) {
  const { isStreaming } = useToolCallSession();
  const command = part.input?.command ?? "";
  const hasOutput = part.state === "output-available";
  const isError = part.state === "output-error";

  const { highlightedHtml } = useSyntaxHighlighting({
    code: command || undefined,
    language: "shellscript",
  });

  if (!part.input) {
    return null;
  }

  const outputTrimmed = hasOutput ? part.output.output.trim() : "";
  const outputText = hasOutput
    ? outputTrimmed
    : isError
      ? `Error: ${part.errorText || "Command failed"}`
      : "";

  const hasExitError = hasOutput && part.output.exitCode !== 0;
  const isFailed = isError || hasExitError;
  const contextItems = part.metadata.contextItems ?? [];
  const browserObservations: BrowserCommandObservation[] = contextItems;

  return (
    <ToolCard>
      <ToolCardHeader>
        <p className="text-xs font-medium text-muted-foreground">
          {getToolLabel("bash")}
        </p>
      </ToolCardHeader>

      <ToolCardSection
        borderBottom={hasOutput || isError}
        copyText={isStreaming ? undefined : command}
        maxHeight="max-h-32"
      >
        <div className="flex pr-7 font-mono text-sm leading-relaxed">
          <span className="mr-2 shrink-0 text-muted-foreground select-none">
            $
          </span>
          {highlightedHtml ? (
            <div
              className="min-w-0 [&_.shiki]:bg-transparent [&_pre]:break-all [&_pre]:whitespace-pre-wrap"
              dangerouslySetInnerHTML={{ __html: highlightedHtml.join("\n") }}
            />
          ) : (
            <span className="break-all whitespace-pre-wrap">{command}</span>
          )}
        </div>
      </ToolCardSection>

      {(hasOutput || isError) && (
        <>
          {browserObservations.length > 0 && (
            <AgentBrowserPlayer
              assetBaseUrl={assetBaseUrl}
              isStreaming={isStreaming}
              observations={browserObservations}
            />
          )}
          <ToolCardSection
            copyText={isStreaming ? undefined : outputText}
            maxHeight="max-h-44"
          >
            {outputText.length > 0 ? (
              <pre
                className={cn(
                  "pr-7 font-mono text-sm break-words whitespace-pre-wrap",
                  isFailed
                    ? "text-destructive"
                    : "text-success-700 dark:text-success-300",
                )}
              >
                {outputText}
              </pre>
            ) : (
              <p className="font-mono text-sm leading-relaxed text-muted-foreground italic">
                No output
              </p>
            )}
          </ToolCardSection>
        </>
      )}
    </ToolCard>
  );
}

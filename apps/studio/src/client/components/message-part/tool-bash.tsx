import { type SessionMessagePart } from "@instrument-org/workspace/client";

import { useSyntaxHighlighting } from "../../hooks/use-syntax-highlighting";
import { getToolLabel } from "../../lib/tool-display";
import { cn } from "../../lib/utils";
import { AgentBrowserPlayer } from "../tool-part/agent-browser-player";
import { ToolCard, ToolCardHeader, ToolCardSection } from "./tool-card";
import { useToolCallSession } from "./tool-call-session";

type BashPart = Extract<SessionMessagePart.ToolPart, { type: "tool-bash" }>;
type BrowserCommandObservation = Extract<
  SessionMessagePart.ToolPartContextItem,
  { kind: "agent-browser-command" }
>;

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
                    : "text-success-600 dark:text-success-400",
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

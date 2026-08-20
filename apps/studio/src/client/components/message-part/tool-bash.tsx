import { type SessionMessagePart } from "@instrument-org/workspace/client";

import { useSyntaxHighlighting } from "../../hooks/use-syntax-highlighting";
import { getToolLabel, getToolStreamingLabel } from "../../lib/tool-display";
import { cn } from "../../lib/utils";
import { Favicon } from "../favicon";
import { isFailedBashExitCode } from "./bash-exit-status";
import { useToolCallSession } from "./tool-call-session";
import {
  ToolCard,
  ToolCardEmpty,
  ToolCardHeader,
  ToolCardSection,
  ToolChip,
} from "./tool-card";

export interface BrowserInfo {
  /** Sorted by visit count, descending. */
  domains: string[];
}
type BashPart = Extract<SessionMessagePart.ToolPart, { type: "tool-bash" }>;

const MAX_BASH_COMMAND_CHIPS = 3;

export function BashCommandChip({ commands }: { commands: string[] }) {
  if (commands.length === 0) {
    return null;
  }
  const visible = commands.slice(0, MAX_BASH_COMMAND_CHIPS);
  const extra = commands.length - visible.length;
  return (
    <ToolChip className="max-w-[10rem] gap-1 px-1.5">
      <span className="truncate font-mono text-xs text-foreground/50">
        {visible.join(", ")}
      </span>
      {extra > 0 && (
        <span className="shrink-0 text-xs text-foreground/30">+{extra}</span>
      )}
    </ToolChip>
  );
}

export function BrowserChip({ info }: { info: BrowserInfo }) {
  const topDomain = info.domains[0] ?? "";
  const extra = info.domains.length - 1;

  return (
    <ToolChip className="max-w-[12rem]">
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

export function ToolBash({ part }: { part: BashPart }) {
  const { isStreaming } = useToolCallSession();
  const command = part.input?.command ?? "";
  const hasOutput = part.state === "output-available";
  const isError = part.state === "output-error";

  const { highlightedHtml } = useSyntaxHighlighting({
    code: command || undefined,
    language: "shellscript",
  });

  if (!part.input) {
    return <ToolCardEmpty message="The command has not arrived yet." />;
  }

  const outputTrimmed = hasOutput ? part.output.output.trim() : "";
  const outputText = hasOutput
    ? outputTrimmed
    : isError
      ? `Error: ${part.errorText || "Command failed"}`
      : "";

  const hasExitError = hasOutput && isFailedBashExitCode(part.output.exitCode);
  const isFailed = isError || hasExitError;
  const label = isStreaming
    ? getToolStreamingLabel("bash")
    : getToolLabel("bash");

  return (
    <ToolCard>
      <ToolCardHeader>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
      </ToolCardHeader>

      <ToolCardSection
        borderBottom={hasOutput || isError}
        collapsedHeight={128}
        copyText={isStreaming ? undefined : command}
        wrappable
      >
        <div className="flex font-mono text-sm leading-relaxed">
          <span className="mr-2 shrink-0 text-muted-foreground select-none">
            $
          </span>
          {/* A `<pre>` either way, highlighted or not, because that is what the
              section's wrap toggle reaches for. */}
          {highlightedHtml ? (
            <div
              className="min-w-0 [&_.shiki]:bg-transparent"
              dangerouslySetInnerHTML={{ __html: highlightedHtml.join("\n") }}
            />
          ) : (
            <pre className="min-w-0">{command}</pre>
          )}
        </div>
      </ToolCardSection>

      {(hasOutput || isError) && (
        <ToolCardSection
          collapsedHeight={176}
          copyText={isStreaming ? undefined : outputText}
          wrappable
        >
          {outputText.length > 0 ? (
            <pre
              className={cn(
                "font-mono text-sm",
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
      )}
    </ToolCard>
  );
}

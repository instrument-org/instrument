import { type SessionMessagePart } from "@instrument-org/workspace/client";
import { CopyIcon } from "@phosphor-icons/react";

import { getToolLabel } from "../../lib/tool-display";
import { cn } from "../../lib/utils";
import { ConfirmedIconButton } from "../confirmed-icon-button";

type BashPart = Extract<SessionMessagePart.ToolPart, { type: "tool-bash" }>;

export function ToolBash({
  isStreaming,
  part,
}: {
  isStreaming: boolean;
  part: BashPart;
}) {
  if (!part.input) {
    return null;
  }

  const command = part.input.command || "";
  const hasOutput = part.state === "output-available";
  const isError = part.state === "output-error";

  const outputTrimmed = hasOutput ? part.output.output.trim() : "";
  const outputText = hasOutput
    ? outputTrimmed
    : isError
      ? `Error: ${part.errorText || "Command failed"}`
      : "";

  const hasExitError = hasOutput && part.output.exitCode !== 0;
  const isFailed = isError || hasExitError;

  return (
    <div className="group/card mt-2 overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border bg-muted px-4 py-3">
        <p className="text-xs font-medium text-muted-foreground">
          {getToolLabel("bash")}
        </p>
      </div>

      <Section
        borderBottom={hasOutput || isError}
        copyText={isStreaming ? undefined : command}
        maxHeight="max-h-32"
      >
        <pre className="pr-7 font-mono text-sm leading-relaxed break-all whitespace-pre-wrap">
          <span className="text-muted-foreground select-none">{"$ "}</span>
          <span className="text-blue-600 dark:text-blue-400">{command}</span>
        </pre>
      </Section>

      {(hasOutput || isError) && (
        <Section
          copyText={isStreaming ? undefined : outputText}
          maxHeight="max-h-44"
        >
          {outputText.length > 0 ? (
            <pre
              className={cn(
                "pr-7 font-mono text-sm leading-relaxed break-all whitespace-pre-wrap",
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
        </Section>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
  };

  return (
    <ConfirmedIconButton
      className="size-5 shrink-0 p-0 text-muted-foreground/60 opacity-0 transition-opacity duration-200 group-hover/card:opacity-100 hover:text-foreground"
      icon={CopyIcon}
      onClick={handleCopy}
      successTooltip="Copied!"
      tooltip="Copy"
      variant="ghost"
    />
  );
}

function Section({
  borderBottom = false,
  children,
  copyText,
  maxHeight,
}: {
  borderBottom?: boolean;
  children: React.ReactNode;
  copyText?: string;
  maxHeight: string;
}) {
  return (
    <div className={cn("relative", borderBottom && "border-b border-border")}>
      <div
        className={cn(
          "overflow-y-auto px-4 py-3 scrollbar-color scrollbar-thin",
          maxHeight,
        )}
      >
        {children}
      </div>
      {copyText && (
        <div className="absolute top-2 right-2">
          <CopyButton text={copyText} />
        </div>
      )}
    </div>
  );
}

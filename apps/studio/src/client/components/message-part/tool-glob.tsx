import { type SessionMessagePart } from "@instrument-org/workspace/client";

import { getToolLabel, getToolStreamingLabel } from "../../lib/tool-display";
import { ToolCard, ToolCardHeader, ToolCardSection } from "./tool-card";

type GlobPart = Extract<SessionMessagePart.ToolPart, { type: "tool-glob" }>;

export function ToolGlob({
  isStreaming,
  part,
}: {
  isStreaming: boolean;
  part: GlobPart;
}) {
  if (!part.input) {
    return null;
  }

  const hasOutput = part.state === "output-available";
  const command = buildCommand(part.input);
  const files = hasOutput ? part.output.files : [];

  const label = isStreaming
    ? getToolStreamingLabel("glob")
    : getToolLabel("glob");

  return (
    <ToolCard>
      <ToolCardHeader>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
      </ToolCardHeader>

      <ToolCardSection
        borderBottom={hasOutput && files.length > 0}
        copyText={command}
        maxHeight="max-h-16"
      >
        <div className="flex font-mono text-sm leading-relaxed">
          <span className="mr-2 shrink-0 text-muted-foreground select-none">
            $
          </span>
          <span className="break-all whitespace-pre-wrap">{command}</span>
        </div>
      </ToolCardSection>

      {hasOutput && (
        <ToolCardSection maxHeight="max-h-64">
          {files.length > 0 ? (
            <div className="space-y-0.5">
              {files.map((file, index) => (
                <p
                  className="font-mono text-sm text-success-600 dark:text-success-400"
                  key={index}
                >
                  {file}
                </p>
              ))}
              {part.output.truncated && (
                <p className="pt-1 font-mono text-sm text-muted-foreground italic">
                  Showing {files.length} of {part.output.totalFiles} files
                </p>
              )}
            </div>
          ) : (
            <p className="font-mono text-sm text-muted-foreground italic">
              No files found
            </p>
          )}
        </ToolCardSection>
      )}
    </ToolCard>
  );
}

function buildCommand(input: NonNullable<GlobPart["input"]>): string {
  const pattern = input.pattern ?? "";
  const path = input.path ?? "";
  const base = path ? `${path}/${pattern}` : pattern;
  return `glob "${base}"`;
}

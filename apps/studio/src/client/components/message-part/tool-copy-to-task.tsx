import {
  formatBytes,
  type SessionMessagePart,
} from "@instrument-org/workspace/client";

import { getToolLabel, getToolStreamingLabel } from "../../lib/tool-display";
import { useToolCallSession } from "./tool-call-session";
import { ToolCard, ToolCardHeader, ToolCardSection } from "./tool-card";

type CopyToTaskPart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-copy_to_project" }
>;

export function ToolCopyToTask({ part }: { part: CopyToTaskPart }) {
  const { isStreaming } = useToolCallSession();
  if (!part.input) {
    return null;
  }

  const hasOutput = part.state === "output-available";
  const label = isStreaming
    ? getToolStreamingLabel("copy_to_project")
    : getToolLabel("copy_to_project");

  return (
    <ToolCard>
      <ToolCardHeader>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
      </ToolCardHeader>

      <ToolCardSection maxHeight="max-h-64">
        <p className="mb-2 font-mono text-sm text-muted-foreground">
          {part.input.pattern}
          {part.input.path && (
            <span className="ml-2 opacity-60">from {part.input.path}</span>
          )}
        </p>

        {hasOutput && (
          <>
            {part.output.files.length > 0 ? (
              <div className="space-y-0.5">
                {part.output.files.map((file, index) => (
                  <div className="flex items-baseline gap-2" key={index}>
                    <p className="min-w-0 truncate font-mono text-sm">
                      {file.destinationPath}
                    </p>
                    <p className="shrink-0 font-mono text-sm text-muted-foreground">
                      {formatBytes(file.size)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                No files copied
              </p>
            )}

            {part.output.truncationReason !== null && (
              <p className="mt-2 text-sm text-muted-foreground italic">
                {part.output.truncatedCount} file
                {part.output.truncatedCount === 1 ? "" : "s"} not copied &mdash;{" "}
                {part.output.truncationReason === "file_count_limit"
                  ? "file count limit reached"
                  : "total size limit reached"}
                .
              </p>
            )}

            {part.output.errors.length > 0 && (
              <div className="mt-3 space-y-1 border-t border-border pt-2">
                {part.output.errors.map((error, index) => (
                  <div key={index}>
                    <p className="font-mono text-sm text-muted-foreground">
                      {error.sourcePath}
                    </p>
                    <p className="font-mono text-sm text-destructive">
                      {error.message}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </ToolCardSection>
    </ToolCard>
  );
}

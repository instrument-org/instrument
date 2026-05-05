import { type SessionMessagePart } from "@instrument-org/workspace/client";

import { ToolCard, ToolCardHeader, ToolCardSection } from "./tool-card";

type GrepPart = Extract<SessionMessagePart.ToolPart, { type: "tool-grep" }>;

export function ToolGrep({ part }: { part: GrepPart }) {
  if (!part.input) {
    return null;
  }

  const hasOutput = part.state === "output-available";
  const command = buildCommand(part.input);
  const matches = hasOutput ? part.output.matches : [];
  const totalMatches = hasOutput ? part.output.totalMatches : 0;

  return (
    <ToolCard>
      <ToolCardHeader>
        <p className="text-xs font-medium text-muted-foreground">Search</p>
      </ToolCardHeader>

      <ToolCardSection
        borderBottom={hasOutput && matches.length > 0}
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
          {matches.length > 0 ? (
            <div className="space-y-2">
              {matches.slice(0, 20).map((match, index) => (
                <div key={index}>
                  <p className="font-mono text-sm text-muted-foreground">
                    {match.path}:{match.lineNum}
                  </p>
                  <p className="font-mono text-sm text-success-600 dark:text-success-400">
                    {match.lineText}
                  </p>
                </div>
              ))}
              {totalMatches > 20 && (
                <p className="font-mono text-sm text-muted-foreground italic">
                  +{totalMatches - 20} more matches
                </p>
              )}
            </div>
          ) : (
            <p className="font-mono text-sm text-muted-foreground italic">
              No matches found
            </p>
          )}
        </ToolCardSection>
      )}
    </ToolCard>
  );
}

function buildCommand(input: NonNullable<GrepPart["input"]>): string {
  const pattern = input.pattern ?? "";
  const parts = ["rg", `"${pattern}"`];
  if (input.include) {
    parts.push(`--glob "${input.include}"`);
  }
  if (input.path) {
    parts.push(input.path);
  }
  return parts.join(" ");
}

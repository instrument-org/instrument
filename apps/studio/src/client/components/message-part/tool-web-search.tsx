import { type SessionMessagePart } from "@instrument-org/workspace/client";

import { getToolLabel } from "../../lib/tool-display";
import { SessionMarkdown } from "../session-markdown";
import { SourceLink } from "../source-link";
import { ToolCard, ToolCardHeader, ToolCardSection } from "./tool-card";

type WebSearchPart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-web_search" }
>;

export function ToolWebSearch({ part }: { part: WebSearchPart }) {
  if (!part.input) {
    return null;
  }

  const successOutput =
    part.state === "output-available" && part.output.state === "success"
      ? part.output
      : null;

  return (
    <ToolCard>
      <ToolCardHeader>
        <p className="text-xs font-medium text-muted-foreground">
          {getToolLabel("web_search")}
        </p>
      </ToolCardHeader>

      <ToolCardSection maxHeight="max-h-[28rem]">
        <p className="mb-3 font-mono text-sm text-muted-foreground">
          {part.input.query}
        </p>

        {successOutput && (
          <SessionMarkdown className="w-full" markdown={successOutput.text} />
        )}

        {successOutput && successOutput.sources.length > 0 && (
          <div className="mt-4 space-y-2 border-t border-border pt-3">
            {successOutput.sources.map((source, index) => (
              <SourceLink key={index} title={source.title} url={source.url} />
            ))}
          </div>
        )}
      </ToolCardSection>
    </ToolCard>
  );
}

import { type SessionMessagePart } from "@instrument-org/workspace/client";

import { getToolLabel, getToolStreamingLabel } from "../../lib/tool-display";
import { SessionMarkdown } from "../session-markdown";
import { SourceLink } from "../source-link";
import { ToolCard, ToolCardHeader, ToolCardSection } from "./tool-card";

type WebSearchPart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-web_search" }
>;

export function ToolWebSearch({
  isStreaming,
  part,
}: {
  isStreaming: boolean;
  part: WebSearchPart;
}) {
  if (!part.input) {
    return null;
  }

  const successOutput =
    part.state === "output-available" && part.output.state === "success"
      ? part.output
      : null;

  const label = isStreaming
    ? getToolStreamingLabel("web_search")
    : getToolLabel("web_search");

  return (
    <ToolCard>
      <ToolCardHeader>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
      </ToolCardHeader>

      <ToolCardSection
        borderBottom={!!successOutput}
        copyText={part.input.query}
        maxHeight="max-h-16"
      >
        <div className="flex font-mono text-sm leading-relaxed">
          <span className="mr-2 shrink-0 text-muted-foreground select-none">
            &gt;
          </span>
          <span className="break-all whitespace-pre-wrap">
            {part.input.query}
          </span>
        </div>
      </ToolCardSection>

      {successOutput && (
        <ToolCardSection maxHeight="max-h-[28rem]">
          <SessionMarkdown className="w-full" markdown={successOutput.text} />

          {successOutput.sources.length > 0 && (
            <div className="mt-4 space-y-2 border-t border-border pt-3">
              {successOutput.sources.map((source, index) => (
                <SourceLink key={index} title={source.title} url={source.url} />
              ))}
            </div>
          )}
        </ToolCardSection>
      )}
    </ToolCard>
  );
}

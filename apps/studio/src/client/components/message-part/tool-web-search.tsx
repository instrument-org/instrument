import { type SessionMessagePart } from "@instrument-org/workspace/client";

import { getToolLabel } from "../../lib/tool-display";
import { Favicon } from "../favicon";
import { SessionMarkdown } from "../session-markdown";
import { SourceLink } from "../source-link";
import { useToolCallSession } from "./tool-call-session";
import {
  ToolCard,
  ToolCardHeader,
  ToolCardSection,
  ToolChip,
} from "./tool-card";

type WebSearchPart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-web_search" }
>;

export function ToolWebSearch({ part }: { part: WebSearchPart }) {
  const { isStreaming } = useToolCallSession();
  if (!part.input || isStreaming) {
    return null;
  }

  const successOutput =
    part.state === "output-available" && part.output.state === "success"
      ? part.output
      : null;

  const label = getToolLabel("web_search");

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

export function WebSearchChip({
  isEmphasized,
  part,
}: {
  isEmphasized: boolean;
  part: SessionMessagePart.ToolPart;
}) {
  if (
    part.type !== "tool-web_search" ||
    part.state !== "output-available" ||
    part.output.state !== "success" ||
    part.output.sources.length === 0
  ) {
    return null;
  }

  const uniqueUrls = [
    ...new Map(
      part.output.sources.map((s) => {
        const hostname = URL.canParse(s.url) ? new URL(s.url).hostname : s.url;
        return [hostname, s.url];
      }),
    ).values(),
  ].slice(0, 5);

  return (
    <ToolChip className="gap-0 px-1" isEmphasized={isEmphasized}>
      {uniqueUrls.map((url, index) => (
        <Favicon
          className="-ml-0.5 size-3.5 border border-muted bg-background first:ml-0"
          key={index}
          url={url}
        />
      ))}
    </ToolChip>
  );
}

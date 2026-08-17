import { type SessionMessagePart } from "@instrument-org/workspace/client";

import { getToolLabel } from "../../lib/tool-display";
import { SessionMarkdown } from "../session-markdown";
import { SourceLink } from "../source-link";
import { useToolCallSession } from "./tool-call-session";
import {
  ToolCard,
  ToolCardEmpty,
  ToolCardHeader,
  ToolCardSection,
} from "./tool-card";

type WebFetchPart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-web_fetch" }
>;

export function ToolWebFetch({ part }: { part: WebFetchPart }) {
  const { isStreaming } = useToolCallSession();
  if (!part.input) {
    return <ToolCardEmpty message="The address has not arrived yet." />;
  }

  const url = typeof part.input.url === "string" ? part.input.url : "";
  const successOutput =
    part.state === "output-available" && part.output.state === "success"
      ? part.output
      : null;
  const failureOutput =
    part.state === "output-available" && part.output.state === "failure"
      ? part.output
      : null;

  if (!url && !successOutput && !failureOutput) {
    return <ToolCardEmpty message="Nothing came back from the page." />;
  }

  const label = failureOutput
    ? "Web page unavailable"
    : isStreaming
      ? "Reading web page"
      : getToolLabel("web_fetch");
  const hasContent =
    successOutput !== null && successOutput.text.trim().length > 0;

  return (
    <ToolCard>
      <ToolCardHeader>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
      </ToolCardHeader>

      {url && (
        <div className="px-3 pt-2">
          <SourceLink url={url} />
        </div>
      )}

      {failureOutput && (
        <ToolCardSection collapsedHeight={160}>
          <p className="text-xs text-muted-foreground">
            {failureOutput.errorMessage}
          </p>
        </ToolCardSection>
      )}

      {hasContent && (
        <ToolCardSection collapsedHeight={448}>
          {successOutput.format === "markdown" ? (
            <SessionMarkdown className="w-full" markdown={successOutput.text} />
          ) : (
            <pre className="font-mono text-xs wrap-break-word whitespace-pre-wrap text-foreground/80">
              {successOutput.text}
            </pre>
          )}
        </ToolCardSection>
      )}
    </ToolCard>
  );
}

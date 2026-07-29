import { APP_NAME } from "@instrument-org/shared";
import { type SessionMessagePart } from "@instrument-org/workspace/client";

import { getToolLabel } from "../../lib/tool-display";
import { parseWebSearchResults } from "../../lib/web-search-results";
import { Favicon } from "../favicon";
import { SessionMarkdown } from "../session-markdown";
import { SourceLink } from "../source-link";
import { useToolCallSession } from "./tool-call-session";
import { ToolCapabilityFailure } from "./tool-capability-failure";
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

// An excerpt is a passage of somebody else's page, so its headings are sized
// down to sit inside the card rather than compete with the conversation.
const EXCERPT_PROSE =
  "w-full prose-headings:my-1 prose-headings:text-sm prose-headings:font-medium prose-p:my-1";

// Keyed by the failure the tool reported, including `no-web-search-model` from
// transcripts recorded before the search backends were named apart.
const PROVIDER_GUARDS: Record<string, string> = {
  "no-search-backend": `Sign up for ${APP_NAME} or add an AI provider that supports web search.`,
  "no-web-search-model": `Sign up for ${APP_NAME} or add an AI provider that supports web search.`,
  "not-authenticated": `Sign in to ${APP_NAME} to use web search.`,
  "payment-required": `Add credits to your ${APP_NAME} account to keep searching the web.`,
};

export function ToolWebSearch({
  onRetry,
  part,
}: {
  onRetry: (prompt: string) => void;
  part: WebSearchPart;
}) {
  const { isStreaming } = useToolCallSession();
  if (!part.input) {
    return null;
  }

  const results =
    part.state === "output-available" && part.output.state === "success"
      ? parseWebSearchResults(part.output)
      : null;
  const failureOutput =
    part.state === "output-available" && part.output.state === "failure"
      ? part.output
      : null;
  const hasSearchContent =
    results !== null &&
    (results.sources.length > 0 ||
      (results.kind === "summary" && results.text.trim().length > 0));

  if (!failureOutput && !hasSearchContent) {
    return null;
  }

  const label = failureOutput
    ? "Web search unavailable"
    : isStreaming
      ? "Searching the web"
      : getToolLabel("web_search");
  const query = typeof part.input.query === "string" ? part.input.query : "";

  return (
    <ToolCard>
      <ToolCardHeader>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
      </ToolCardHeader>

      {failureOutput && (
        <ToolCapabilityFailure
          capabilityLabel="web search"
          errorMessage={failureOutput.errorMessage}
          onRetry={onRetry}
          providerGuardDescription={PROVIDER_GUARDS[failureOutput.errorType]}
          responseBody={failureOutput.responseBody}
          retryMessage={`I added a web search provider. Retry searching for "${query}"`}
        />
      )}

      {results && hasSearchContent && (
        <ToolCardSection maxHeight="max-h-[28rem]">
          {results.kind === "summary" ? (
            <>
              <SessionMarkdown className="w-full" markdown={results.text} />

              {!isStreaming && results.sources.length > 0 && (
                <div className="mt-4 space-y-2 border-t border-border pt-3">
                  {results.sources.map((source, index) => (
                    <SourceLink
                      key={index}
                      title={source.title}
                      url={source.url}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-y-4">
              {results.sources.map((source, index) => (
                <div className="flex min-w-0 flex-col gap-y-1.5" key={index}>
                  <SourceLink title={source.title} url={source.url} />
                  <SessionMarkdown
                    className={EXCERPT_PROSE}
                    hideImages
                    markdown={source.text}
                  />
                </div>
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
    part.output.state !== "success"
  ) {
    return null;
  }

  const results = parseWebSearchResults(part.output);
  if (!results || results.sources.length === 0) {
    return null;
  }

  const uniqueUrls = [
    ...new Map(
      results.sources.map((s) => {
        const hostname = URL.canParse(s.url)
          ? new URL(s.url).hostname.replace(/^www\./, "")
          : s.url;
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

import { APP_NAME } from "@instrument-org/shared";
import {
  readWebSearchResults,
  type SessionMessagePart,
} from "@instrument-org/workspace/client";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";

import { formatDuration } from "../../lib/format-time";
import { UNTRUSTED_FILE_IMAGE_KINDS } from "../../lib/image-policy";
import { getToolLabel } from "../../lib/tool-display";
import { AIProviderIcon } from "../ai-provider-icon";
import { Favicon } from "../favicon";
import { SessionMarkdown } from "../session-markdown";
import { SourceLink } from "../source-link";
import { isActiveToolPart } from "../transcript-layout";
import { ToolCapabilityFailure } from "./tool-capability-failure";
import {
  ToolCard,
  ToolCardEmpty,
  ToolCardHeader,
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
  if (!part.input) {
    return <ToolCardEmpty message="The query has not arrived yet." />;
  }

  const results =
    part.state === "output-available" && part.output.state === "success"
      ? readWebSearchResults(part.output)
      : null;
  const failureOutput =
    part.state === "output-available" && part.output.state === "failure"
      ? part.output
      : null;
  const searching =
    isActiveToolPart(part) ||
    (part.state === "output-available" && part.preliminary === true);
  const hasSearchContent =
    results !== null &&
    (results.sources.length > 0 ||
      (results.kind === "summary" && results.text.trim().length > 0));
  const query = typeof part.input.query === "string" ? part.input.query : "";

  return (
    <ToolCard>
      <ToolCardHeader className="flex flex-col gap-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <MagnifyingGlassIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <p className="min-w-0 truncate text-xs font-medium text-foreground/80">
            {query || getToolLabel("web_search")}
          </p>
        </div>
        <SearchFacts part={part} results={results} searching={searching} />
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

      {!failureOutput && !hasSearchContent && !searching && (
        <p className="px-4 py-3 text-sm text-muted-foreground italic">
          The search returned nothing.
        </p>
      )}

      {/* A summary and an excerpt are both somebody else's page, so their
          markdown gets embedded images only: an `<img>` naming a host is
          fetched the moment the card renders. `hideImages` drops the rest
          outright rather than standing chips in for them; a scraped page
          carries logos and tracker pixels by the dozen, and the page itself
          is a click away through its source link. Drawn whole: the row this
          card sits behind is already the disclosure, so a second one inside
          it only asks for another click. */}
      {results && hasSearchContent && (
        <div className="px-4 py-3">
          {results.kind === "summary" ? (
            <>
              <SessionMarkdown
                className="w-full"
                hideImages
                imageKinds={UNTRUSTED_FILE_IMAGE_KINDS}
                markdown={results.text}
              />

              {!searching && results.sources.length > 0 && (
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
                    imageKinds={UNTRUSTED_FILE_IMAGE_KINDS}
                    markdown={source.text}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </ToolCard>
  );
}

export function WebSearchChip({ part }: { part: SessionMessagePart.ToolPart }) {
  if (
    part.type !== "tool-web_search" ||
    part.state !== "output-available" ||
    part.output.state !== "success"
  ) {
    return null;
  }

  const results = readWebSearchResults(part.output);
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
    <ToolChip className="gap-0 px-1">
      {/* One surface under the whole run rather than one per icon: five icons
          each carrying their own read as a chain of interlocking discs
          instead of as the one thing this chip is. So the row is the pill and
          each icon gives up the tile it would otherwise bring. Its own class
          rather than the favicon's, because what this needs is a shape that
          groups and what that one gives is a lift for legibility. */}
      <span className="flex items-center gap-0.5 rounded-full bg-gray-100 px-0.5 py-px dark:bg-white/10">
        {uniqueUrls.map((url, index) => (
          <Favicon
            className="size-3.5 border-0 bg-transparent ring-0"
            key={index}
            url={url}
          />
        ))}
      </span>
    </ToolChip>
  );
}

function partEndedAt(part: WebSearchPart): number | undefined {
  const endedAt: unknown = (part.metadata as { endedAt?: unknown }).endedAt;
  return endedAt instanceof Date ? endedAt.getTime() : undefined;
}

/**
 * What the search was, in the terms the image card already uses: the model
 * that ran it where a model did, then how many pages it came back with and
 * how long it took. Nothing from the backend's own accounting, which is
 * ours to watch and not the reader's.
 */
function SearchFacts({
  part,
  results,
  searching,
}: {
  part: WebSearchPart;
  results: null | ReturnType<typeof readWebSearchResults>;
  searching: boolean;
}) {
  const facts: string[] = [];
  if (results && results.sources.length > 0) {
    facts.push(
      `${String(results.sources.length)} ${results.sources.length === 1 ? "source" : "sources"}`,
    );
  }
  const endedAt = partEndedAt(part);
  if (!searching && endedAt) {
    facts.push(formatDuration(endedAt - part.metadata.createdAt.getTime()));
  }
  const summary = results?.kind === "summary" ? results : undefined;
  const modelName = summary?.modelIdServed ?? summary?.modelId;

  if (!searching && !modelName && facts.length === 0) {
    return null;
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {searching && <span>Searching the web…</span>}
      {modelName && (
        <span className="inline-flex items-center gap-1 rounded-full bg-background/60 px-2 py-0.5">
          {summary?.provider && (
            <AIProviderIcon
              className="size-3 shrink-0 opacity-70"
              displayName={summary.provider.displayName}
              showTooltip
              type={summary.provider.type}
            />
          )}
          <span className="font-medium text-foreground/80">{modelName}</span>
        </span>
      )}
      {facts.map((fact) => (
        <span key={fact}>{fact}</span>
      ))}
    </div>
  );
}

import { type PlanRefusal } from "@instrument-org/shared";
import { z } from "zod";

const WebSearchRequestSchema = z.object({
  query: z.string().min(1),
});

// The contract of the platform's own search endpoint, not of whichever engine
// sits behind it: the server normalizes the engine's results, so it can change
// engines without a client release.
const WebSearchResultSchema = z.object({
  author: z.string().optional(),
  // The site icon and the page's lead image. Optional because a server that
  // predates them omits both, and because not every page has either.
  favicon: z.string().optional(),
  image: z.string().optional(),
  publishedDate: z.string().optional(),
  // The part of the page that answers the query, as markdown.
  text: z.string(),
  title: z.string().optional(),
  url: z.string(),
});

export const WebSearchResponseSchema = z.object({
  results: z.array(WebSearchResultSchema),
});

export type WebSearchClient = ({
  input,
  signal,
}: {
  input: WebSearchRequest;
  signal: AbortSignal;
}) => Promise<WebSearchClientResult>;
export type WebSearchClientResult =
  | { data: WebSearchResponse; ok: true }
  | {
      errorMessage: string;
      // `payment-required` and `not-authenticated` are the user's to resolve;
      // everything else is ours to absorb (see the fallback in lib/web-search).
      errorType: "not-authenticated" | "payment-required" | "request-failed";
      ok: false;
      /**
       * The platform turned the search away for the account's plan
       * (`subscription-required`, or `usage-limit-exceeded` while the free
       * allowance is spent), and what it said.
       */
      refusal?: PlatformSearchRefusal;
      responseBody?: string;
    };

/** Why the platform refused a search for the account's plan, as it said. */
export type PlatformSearchRefusal = PlanRefusal;

export type WebSearchRequest = z.output<typeof WebSearchRequestSchema>;

export type WebSearchResult = z.output<typeof WebSearchResultSchema>;

type WebSearchResponse = z.output<typeof WebSearchResponseSchema>;

export const unavailableWebSearchClient: WebSearchClient = () =>
  Promise.resolve({
    errorMessage: "Web search is unavailable in this environment.",
    errorType: "request-failed",
    ok: false,
  });

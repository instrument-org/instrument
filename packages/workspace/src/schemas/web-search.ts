import { z } from "zod";

const WebSearchRequestSchema = z.object({
  query: z.string().min(1),
});

const WebSearchResultSchema = z.object({
  author: z.string().optional(),
  highlights: z.array(z.string()),
  publishedDate: z.string().optional(),
  title: z.string().optional(),
  url: z.string(),
});

export const WebSearchResponseSchema = z.object({
  costDollars: z.number(),
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
      errorType: "not-authenticated" | "request-failed";
      ok: false;
      responseBody?: string;
    };

export type WebSearchRequest = z.output<typeof WebSearchRequestSchema>;

type WebSearchResponse = z.output<typeof WebSearchResponseSchema>;

export const unavailableWebSearchClient: WebSearchClient = () =>
  Promise.resolve({
    errorMessage: "Web search is unavailable in this environment.",
    errorType: "request-failed",
    ok: false,
  });

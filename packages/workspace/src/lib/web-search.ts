import { type WebSearchClientResult } from "../schemas/web-search";
import { type WorkspaceConfig } from "../types";

type WebSearchFailure = Extract<WebSearchClientResult, { ok: false }>;

export async function webSearch({
  prompt,
  signal,
  workspaceConfig,
}: {
  prompt: string;
  signal: AbortSignal;
  workspaceConfig: WorkspaceConfig;
}): Promise<
  | WebSearchFailure
  | {
      data: {
        costDollars: number;
        sources: {
          author?: string;
          highlights: string[];
          publishedDate?: string;
          title?: string;
          url: string;
        }[];
        text: string;
      };
      ok: true;
    }
> {
  const response = await workspaceConfig.webSearch({
    input: { query: prompt },
    signal,
  });
  if (!response.ok) {
    return response;
  }

  return {
    data: {
      costDollars: response.data.costDollars,
      sources: response.data.results,
      text: formatSearchResults(response.data.results),
    },
    ok: true,
  };
}

function formatSearchResults(
  results: {
    author?: string;
    highlights: string[];
    publishedDate?: string;
    title?: string;
    url: string;
  }[],
) {
  return results
    .map((result, index) => {
      const metadata = [
        result.publishedDate
          ? `Published or updated: ${result.publishedDate}`
          : undefined,
        result.author ? `Author: ${result.author}` : undefined,
      ].filter((value): value is string => value !== undefined);
      const highlights = result.highlights
        .map((highlight) => highlight.trim())
        .filter(Boolean)
        .join("\n\n");

      return [
        `### ${index + 1}. ${result.title ?? "Untitled result"}`,
        metadata.join("\n"),
        highlights,
      ]
        .filter(Boolean)
        .join("\n\n");
    })
    .join("\n\n");
}

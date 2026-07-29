import { z } from "zod";

/**
 * Tool output is cast to the current build's type when a part is read back from
 * the store, never validated (see `SessionMessagePart.coerce`), so a transcript
 * written by a build whose `web_search` schema differed still arrives typed as
 * today's shape and throws only once something reads a field it lacks. Reading
 * results back through a schema is what keeps an older task openable.
 */

const SummarySourceSchema = z.object({
  title: z.string().optional(),
  url: z.string(),
});

const ExcerptSourceSchema = z.object({
  author: z.string().optional(),
  publishedDate: z.string().optional(),
  text: z.string(),
  title: z.string().optional(),
  url: z.string(),
});

const CurrentSchema = z
  .object({
    results: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("excerpts"),
        sources: z.array(ExcerptSourceSchema),
      }),
      z.object({
        kind: z.literal("summary"),
        sources: z.array(SummarySourceSchema),
        text: z.string(),
      }),
    ]),
  })
  .transform((output) => output.results);

// Recorded while the search endpoint returned each page as an array of
// query-relevant spans instead of one passage.
const SpansSchema = z
  .object({
    sources: z.array(
      ExcerptSourceSchema.omit({ text: true }).extend({
        highlights: z.array(z.string()),
      }),
    ),
  })
  .transform((output) => ({
    kind: "excerpts" as const,
    sources: output.sources.map(({ highlights, ...source }) => ({
      ...source,
      text: highlights.join("\n\n"),
    })),
  }));

// Recorded before the tool could return excerpts at all, when every search was
// a search model summarizing what it read.
const FlatSummarySchema = z
  .object({
    sources: z.array(SummarySourceSchema),
    text: z.string(),
  })
  .transform((output) => ({
    kind: "summary" as const,
    sources: output.sources,
    text: output.text,
  }));

const WebSearchResultsSchema = z.union([
  CurrentSchema,
  SpansSchema,
  FlatSummarySchema,
]);

export type WebSearchResults = z.output<typeof WebSearchResultsSchema>;

export function parseWebSearchResults(output: unknown) {
  const parsed = WebSearchResultsSchema.safeParse(output);
  return parsed.success ? parsed.data : null;
}

import { z } from "zod";

/**
 * Reads the results out of a persisted `web_search` output.
 *
 * `SessionMessagePart.coerce` casts a stored part to the current build's types
 * rather than validating it, so a transcript written when this tool returned a
 * different shape still arrives typed as today's, and only throws once a caller
 * reads a field it does not have. No type can fix that after the fact: the
 * bytes on disk predate the discriminator that would tell the shapes apart, so
 * something has to look at the value. That happens here, once, next to the
 * schemas that define those shapes, rather than in each component that renders
 * them.
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

/** Returns null for output too damaged to render, rather than throwing. */
export function readWebSearchResults(output: unknown) {
  const parsed = WebSearchResultsSchema.safeParse(output);
  return parsed.success ? parsed.data : null;
}

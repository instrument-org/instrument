import { z } from "zod";

/**
 * Reads the results out of a persisted `web_search` output.
 *
 * `SessionMessagePart.coerce` casts a stored part to the current build's types
 * rather than validating it, so whatever a past build wrote arrives typed as
 * today's shape and only throws once a caller reads a field it does not have.
 * That is what this guards: not any particular old format, but the cast itself.
 *
 * Results this build did not write are reported as unreadable rather than
 * translated. A search in an old task then shows as unavailable instead of
 * rendering, which is the accepted trade while the format is still moving.
 */

const ResultsSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("excerpts"),
    sources: z.array(
      z.object({
        author: z.string().optional(),
        publishedDate: z.string().optional(),
        text: z.string(),
        title: z.string().optional(),
        url: z.string(),
      }),
    ),
  }),
  z.object({
    kind: z.literal("summary"),
    sources: z.array(
      z.object({ title: z.string().optional(), url: z.string() }),
    ),
    text: z.string(),
  }),
]);

const WebSearchOutputSchema = z.object({ results: ResultsSchema });

/** Returns null for output this build cannot render, rather than throwing. */
export function readWebSearchResults(output: unknown) {
  const parsed = WebSearchOutputSchema.safeParse(output);
  return parsed.success ? parsed.data.results : null;
}

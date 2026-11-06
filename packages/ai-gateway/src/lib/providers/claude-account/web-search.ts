import { randomUUID } from "node:crypto";
import { z } from "zod";

/**
 * The name a Claude account step reports Claude Code's own WebSearch by, as a
 * call the provider ran (`providerExecuted`), with its input `{ query }` and
 * its result in {@link ClaudeWebSearchResultSchema}.
 */
export const CLAUDE_WEB_SEARCH_TOOL_NAME = "WebSearch";

/**
 * What one WebSearch turned up. Claude Code's search is a model call of its
 * own: it hands back the pages that call cited, by title and address only, and
 * the summary it wrote of them, which is what the step's model reads.
 */
export const ClaudeWebSearchResultSchema = z.object({
  /** How long the search took, as Claude Code timed it. */
  durationMs: z.number().optional(),
  query: z.string(),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
  summary: z.string(),
});

/** What a WebSearch run by Claude Code reports, as its tool result. */
const WebSearchOutputSchema = z.object({
  durationSeconds: z.number().optional(),
  query: z.string(),
  results: z.array(
    z.union([
      z.object({
        content: z.array(z.object({ title: z.string(), url: z.string() })),
      }),
      z.string(),
    ]),
  ),
});

/** The id of the call a tool result answers, where the message names one. */
const ToolResultMessageSchema = z.object({
  content: z.array(z.looseObject({ tool_use_id: z.string().optional() })),
});

/**
 * The search a user message from Claude Code carries the result of, or none
 * for any other message. Its id is the call's own where the message names it,
 * since a replay writes the call back under that id.
 */
export function webSearchOf(message: {
  message?: unknown;
  tool_use_result?: unknown;
}) {
  const parsed = WebSearchOutputSchema.safeParse(message.tool_use_result);
  if (!parsed.success) {
    return undefined;
  }
  const { durationSeconds, query, results } = parsed.data;
  const id = ToolResultMessageSchema.safeParse(message.message)
    .data?.content.map((block) => block.tool_use_id)
    .find((toolUseId) => toolUseId !== undefined);
  return {
    id: id ?? randomUUID(),
    result: {
      ...(durationSeconds !== undefined && {
        durationMs: Math.round(durationSeconds * 1000),
      }),
      query,
      sources: results.flatMap((entry) =>
        typeof entry === "string" ? [] : entry.content,
      ),
      summary: results
        .filter((entry) => typeof entry === "string")
        .join("\n\n"),
    } satisfies z.output<typeof ClaudeWebSearchResultSchema>,
  };
}

import { sum } from "radashi";
import { z } from "zod";

import { type SessionMessage } from "../schemas/session/message";
import { isToolPart } from "./is-tool-part";

// Pure usage-summary computation over already-loaded messages, kept free of the
// server-only Store so the client can compute the same numbers from messages it
// already holds (see usage-summary.ts for the DB-loading variant).

export const UsageSummarySchema = z.object({
  inputTokenDetails: z.object({
    cacheReadTokens: z.number(),
    cacheWriteTokens: z.number(),
    noCacheTokens: z.number(),
  }),
  inputTokens: z.number(),
  messageCount: z.number(),
  msToFinish: z.number(),
  outputTokenDetails: z.object({
    reasoningTokens: z.number(),
    textTokens: z.number(),
  }),
  outputTokens: z.number(),
  totalTokens: z.number(),
});

export type UsageSummary = z.output<typeof UsageSummarySchema>;

// Parts are cast to their strict types when they come back from the store, not
// validated (see SessionMessagePart.coerce), so a tool output persisted by a
// build whose schema differed can be missing fields this one marks required.
// Totals are a reporting detail, so read them back through a schema and count
// whatever doesn't fit as zero instead of throwing out of the UI rendering it.
// eslint-disable-next-line unicorn/prefer-top-level-await
const TokenCountSchema = z.number().catch(0);

const TokenTotalsSchema = z.object({
  inputTokens: TokenCountSchema,
  outputTokens: TokenCountSchema,
  totalTokens: TokenCountSchema,
});

const NO_TOKENS = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

const ToolPartUsageSchema = z
  .union([
    z
      .object({ results: z.object({ usage: TokenTotalsSchema }) })
      .transform((output) => ({ usage: output.results.usage })),
    z.object({ usage: TokenTotalsSchema }),
  ])
  // eslint-disable-next-line unicorn/prefer-top-level-await
  .catch({ usage: NO_TOKENS });

const EPOCH = new Date(0);

const ToolPartTimingSchema = z
  .object({ createdAt: z.date(), endedAt: z.date() })
  // eslint-disable-next-line unicorn/prefer-top-level-await
  .catch({ createdAt: EPOCH, endedAt: EPOCH });

export function emptyUsageSummary(): UsageSummary {
  return {
    inputTokenDetails: {
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      noCacheTokens: 0,
    },
    inputTokens: 0,
    messageCount: 0,
    msToFinish: 0,
    outputTokenDetails: {
      reasoningTokens: 0,
      textTokens: 0,
    },
    outputTokens: 0,
    totalTokens: 0,
  };
}

export function getUsageSummaryFromMessages(
  allMessages: SessionMessage.WithParts[],
): UsageSummary {
  const assistantMessages = allMessages.filter((m) => m.role === "assistant");

  const toolParts = assistantMessages.flatMap((m) =>
    m.parts.flatMap((part) => {
      if (
        !isToolPart(part) ||
        part.state !== "output-available" ||
        (part.type !== "tool-generate_image" && part.type !== "tool-web_search")
      ) {
        return [];
      }
      const output = part.output;
      if (output.state !== "success") {
        return [];
      }
      return [
        {
          metadata: ToolPartTimingSchema.parse(part.metadata),
          usage: ToolPartUsageSchema.parse(output).usage,
        },
      ];
    }),
  );

  return {
    inputTokenDetails: {
      cacheReadTokens: sum(assistantMessages, (m) =>
        finite(m.metadata.usage?.inputTokenDetails.cacheReadTokens),
      ),
      cacheWriteTokens: sum(assistantMessages, (m) =>
        finite(m.metadata.usage?.inputTokenDetails.cacheWriteTokens),
      ),
      noCacheTokens: sum(assistantMessages, (m) =>
        finite(m.metadata.usage?.inputTokenDetails.noCacheTokens),
      ),
    },
    inputTokens:
      sum(assistantMessages, (m) => finite(m.metadata.usage?.inputTokens)) +
      sum(toolParts, (p) => p.usage.inputTokens),
    messageCount: allMessages.length,
    msToFinish:
      sum(assistantMessages, (m) => finite(m.metadata.msToFinish)) +
      sum(
        toolParts,
        (p) => p.metadata.endedAt.getTime() - p.metadata.createdAt.getTime(),
      ),
    outputTokenDetails: {
      reasoningTokens: sum(assistantMessages, (m) =>
        finite(m.metadata.usage?.outputTokenDetails.reasoningTokens),
      ),
      textTokens: sum(assistantMessages, (m) =>
        finite(m.metadata.usage?.outputTokenDetails.textTokens),
      ),
    },
    outputTokens:
      sum(assistantMessages, (m) => finite(m.metadata.usage?.outputTokens)) +
      sum(toolParts, (p) => p.usage.outputTokens),
    totalTokens:
      sum(assistantMessages, (m) => finite(m.metadata.usage?.totalTokens)) +
      sum(toolParts, (p) => p.usage.totalTokens),
  };
}

function finite(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : 0;
}

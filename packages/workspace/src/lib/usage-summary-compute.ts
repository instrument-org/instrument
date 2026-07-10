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
      return [{ metadata: part.metadata, usage: output.usage }];
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
      sum(toolParts, (p) => finite(p.usage.inputTokens)),
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
      sum(toolParts, (p) => finite(p.usage.outputTokens)),
    totalTokens:
      sum(assistantMessages, (m) => finite(m.metadata.usage?.totalTokens)) +
      sum(toolParts, (p) => finite(p.usage.totalTokens)),
  };
}

function finite(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : 0;
}

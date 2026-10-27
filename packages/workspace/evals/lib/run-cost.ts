import fs from "node:fs/promises";
import path from "node:path";
import { parallel } from "radashi";
import { z } from "zod";

import { ChatReads } from "../../src/lib/chat-reads";
import { chatDir } from "../../src/lib/record-folders";
import { isToolPart } from "../../src/lib/is-tool-part";
import { type ChatId } from "../../src/schemas/chat-id";
import { type SessionMessage } from "../../src/schemas/session/message";
import { type StoreId } from "../../src/schemas/store-id";
import { costOfUsage, formatCost, type ModelPrice } from "../utils";

/**
 * What a run's model requests cost, step by step, and how each figure was
 * arrived at.
 *
 * A step's own response is the bill when it carries one: OpenRouter reports
 * what it charged in `usage.raw.cost`, and for a key the person brought
 * (`is_byok`) that is only OpenRouter's fee, with the provider's own charge
 * in `cost_details.upstream_inference_cost`. A catalog price is the fallback
 * for a step that reported nothing, and it is only an estimate: it knows one
 * rate per kind of token, and a provider can charge more past a prompt
 * length (Claude Haiku 5.5 bills five times its base rates past 100K), which
 * put a 35-turn run's estimate at a third of its bill.
 *
 * Web searches are their own figure. The search runs its own model request,
 * whose bill the tool's output does not keep, so it is priced from the
 * tokens it reports at the search model's catalog rate, and any per-search
 * fee the provider adds is in neither number.
 */
export interface RunCost {
  /** Dollars the providers reported charging, over `billedSteps` steps. */
  billedUSD: number;
  billedSteps: number;
  /** Dollars priced from the catalog for steps that reported no charge. */
  estimatedUSD: number;
  estimatedSteps: number;
  /** Steps that reported no charge and whose model has no known price. */
  unpricedSteps: number;
  /**
   * Steps that ended with no usage at all: stopped before the provider's
   * final chunk, which is the one carrying usage. The provider still bills
   * what it served them, so every figure here is short by that much.
   */
  unmeteredSteps: number;
  search: {
    estimatedUSD: number;
    searches: number;
    /** Searches whose model has no catalog price, left out of `estimatedUSD`. */
    unpriced: number;
  };
}

/** `billed`, `estimate`, or `mixed`: where a run's model cost came from. */
export type CostSource = "billed" | "estimate" | "mixed";

const RawUsageSchema = z
  .object({
    cost: z.number(),
    cost_details: z
      .object({ upstream_inference_cost: z.number().nullish() })
      .nullish(),
    is_byok: z.boolean().optional(),
  })
  .transform(
    ({ cost, cost_details, is_byok }) =>
      cost + (is_byok ? (cost_details?.upstream_inference_cost ?? 0) : 0),
  );

const SearchOutputSchema = z.object({
  results: z.object({
    kind: z.literal("summary"),
    modelId: z.string(),
    usage: z.object({
      inputTokens: z.number().optional(),
      outputTokens: z.number().optional(),
    }),
  }),
  state: z.literal("success"),
});

export function emptyRunCost(): RunCost {
  return {
    billedSteps: 0,
    billedUSD: 0,
    estimatedSteps: 0,
    estimatedUSD: 0,
    search: { estimatedUSD: 0, searches: 0, unpriced: 0 },
    unmeteredSteps: 0,
    unpricedSteps: 0,
  };
}

/** What a step's response said it was charged, from its `usage.raw`. */
export function billedCostOf(raw: unknown): number | undefined {
  const parsed = RawUsageSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export function runCostOf(
  messages: readonly SessionMessage.WithParts[],
  {
    billed,
    price,
    priceFor,
  }: {
    /** What each step's response said it was charged, by message id. */
    billed?: ReadonlyMap<string, number>;
    /** The run's model's catalog price, for a step that reported no charge. */
    price?: ModelPrice;
    /** Any model's catalog price by its OpenRouter slug, for searches. */
    priceFor?: (slug: string) => ModelPrice | undefined;
  },
): RunCost {
  const cost = emptyRunCost();
  for (const message of messages) {
    // A summary written before a request reached its model's price step is
    // a request of its own, recorded on the rollover it made.
    for (const part of message.parts) {
      if (
        part.type !== "data-contextRollover" ||
        part.data.summaryUsage === undefined
      ) {
        continue;
      }
      const charged = billed?.get(part.metadata.id);
      if (charged !== undefined) {
        cost.billedUSD += charged;
        cost.billedSteps += 1;
      } else if (price) {
        const usage = part.data.summaryUsage;
        cost.estimatedUSD += costOfUsage(
          {
            inputTokenDetails: {
              cacheReadTokens: usage.cacheReadTokens ?? 0,
              cacheWriteTokens: usage.cacheWriteTokens ?? 0,
            },
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
          },
          price,
        );
        cost.estimatedSteps += 1;
      } else {
        cost.unpricedSteps += 1;
      }
    }
    if (message.role !== "assistant" || message.metadata.synthetic) {
      continue;
    }
    for (const part of message.parts) {
      if (
        !isToolPart(part) ||
        part.type !== "tool-web_search" ||
        part.state !== "output-available"
      ) {
        continue;
      }
      const search = SearchOutputSchema.safeParse(part.output);
      if (!search.success) {
        continue;
      }
      cost.search.searches += 1;
      const searchPrice = priceFor?.(search.data.results.modelId);
      if (!searchPrice) {
        cost.search.unpriced += 1;
        continue;
      }
      const { inputTokens = 0, outputTokens = 0 } = search.data.results.usage;
      cost.search.estimatedUSD += costOfUsage(
        {
          inputTokenDetails: { cacheReadTokens: 0, cacheWriteTokens: 0 },
          inputTokens,
          outputTokens,
        },
        searchPrice,
      );
    }
    const { usage } = message.metadata;
    if (usage?.totalTokens === undefined || usage.totalTokens === 0) {
      // Stopped after its request went out, which is what gives it a time;
      // one stopped before that, or refused, was never served.
      if (
        message.metadata.error?.kind === "aborted" &&
        message.metadata.msToFinish !== undefined
      ) {
        cost.unmeteredSteps += 1;
      }
      continue;
    }
    const charged = billed?.get(message.id);
    if (charged !== undefined) {
      cost.billedUSD += charged;
      cost.billedSteps += 1;
    } else if (price) {
      cost.estimatedUSD += costOfUsage(
        {
          inputTokenDetails: {
            cacheReadTokens: usage.inputTokenDetails.cacheReadTokens ?? 0,
            cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? 0,
          },
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
        },
        price,
      );
      cost.estimatedSteps += 1;
    } else {
      cost.unpricedSteps += 1;
    }
  }
  return cost;
}

/** The model requests' dollars, absent when no step could be priced. */
export function modelCostUSD(cost: RunCost): number | undefined {
  return cost.billedSteps + cost.estimatedSteps > 0
    ? cost.billedUSD + cost.estimatedUSD
    : undefined;
}

export function costSourceOf(cost: RunCost): CostSource | undefined {
  if (cost.billedSteps > 0 && cost.estimatedSteps > 0) {
    return "mixed";
  }
  if (cost.billedSteps > 0) {
    return "billed";
  }
  return cost.estimatedSteps > 0 ? "estimate" : undefined;
}

/** Several runs' costs as one, for a suite's total. */
export function addRunCosts(costs: readonly RunCost[]): RunCost {
  const total = emptyRunCost();
  for (const cost of costs) {
    total.billedSteps += cost.billedSteps;
    total.billedUSD += cost.billedUSD;
    total.estimatedSteps += cost.estimatedSteps;
    total.estimatedUSD += cost.estimatedUSD;
    total.unmeteredSteps += cost.unmeteredSteps;
    total.unpricedSteps += cost.unpricedSteps;
    total.search.estimatedUSD += cost.search.estimatedUSD;
    total.search.searches += cost.search.searches;
    total.search.unpriced += cost.search.unpriced;
  }
  return total;
}

/**
 * What a run's cost is read from: the messages of a chat's sessions, each
 * session's own, never what a task inherits from its chat (every session of
 * the chat, or the ones named), and what each step's response said it was
 * charged.
 *
 * The charge is read from the session logs as written, since a message read
 * back through the store keeps only the token counts of its usage, and the
 * provider's own report (`usage.raw`) is on the line the turn wrote.
 */
export async function readChatSpend(
  chatId: ChatId,
  sessionIds?: readonly StoreId.Session[],
): Promise<{
  billed: Map<string, number>;
  messages: SessionMessage.WithParts[];
}> {
  let ids = sessionIds;
  if (!ids) {
    const sessions = await ChatReads.sessions({
      chatId,
      includeChildSessions: true,
    });
    ids = sessions.isOk() ? sessions.value.map((session) => session.id) : [];
  }
  const groups = await parallel(5, [...ids], async (sessionId) => {
    const messages = await ChatReads.transcript({
      chatId,
      inherited: false,
      sessionId,
    });
    return messages.isOk() ? messages.value : [];
  });
  return {
    billed: await billedFromLogs(chatId, ids),
    messages: groups.flat(),
  };
}

/** A summarized rollover's line of a session log, as far as its charge goes. */
const LoggedSummarySchema = z.object({
  part: z.object({
    data: z.object({ summaryUsage: z.object({ raw: z.unknown() }) }),
    metadata: z.object({ id: z.string() }),
  }),
  t: z.literal("part"),
});

/** A message line of a session log, as far as its charge goes. */
const LoggedMessageSchema = z.object({
  message: z.object({
    id: z.string(),
    metadata: z.object({
      usage: z.object({ raw: z.unknown() }).nullish(),
    }),
  }),
  t: z.literal("message"),
});

/**
 * Each step's charge in `sessionIds`' logs (`<session>.<device>.jsonl`), by
 * message id, and each summary's, by the id of the rollover part it is on.
 */
async function billedFromLogs(
  chatId: ChatId,
  sessionIds: readonly StoreId.Session[],
): Promise<Map<string, number>> {
  const dir = chatDir(chatId);
  const files = (await fs.readdir(dir).catch(() => [])).filter(
    (name) =>
      name.endsWith(".jsonl") &&
      sessionIds.some((id) => name.startsWith(`${id}.`)),
  );
  const billed = new Map<string, number>();
  for (const file of files) {
    const text = await fs
      .readFile(path.join(dir, file), "utf8")
      .catch(() => "");
    for (const line of text.split("\n")) {
      // Parts far outnumber messages, and of them only a rollover with a
      // summary carries usage.
      const summary =
        line.startsWith('{"t":"part"') &&
        line.includes('"data-contextRollover"') &&
        line.includes('"summaryUsage"');
      if (!line.startsWith('{"t":"message"') && !summary) {
        continue;
      }
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch {
        continue;
      }
      if (summary) {
        const logged = LoggedSummarySchema.safeParse(json);
        const charged = logged.success
          ? billedCostOf(logged.data.part.data.summaryUsage.raw)
          : undefined;
        if (logged.success && charged !== undefined) {
          billed.set(logged.data.part.metadata.id, charged);
        }
        continue;
      }
      const logged = LoggedMessageSchema.safeParse(json);
      if (!logged.success) {
        continue;
      }
      const charged = billedCostOf(logged.data.message.metadata.usage?.raw);
      if (charged !== undefined) {
        billed.set(logged.data.message.id, charged);
      }
    }
  }
  return billed;
}

/**
 * A run's cost in a line: the model requests' figure and where it came from,
 * then searches and anything left unpriced. Absent when nothing was priced
 * and nothing is worth saying.
 */
export function describeCost(cost: RunCost): string | undefined {
  const pieces: string[] = [];
  if (cost.billedSteps > 0) {
    pieces.push(`${formatCost(cost.billedUSD)} billed`);
  }
  if (cost.estimatedSteps > 0) {
    pieces.push(`~${formatCost(cost.estimatedUSD)} estimated`);
  }
  const notes: string[] = [];
  if (cost.search.searches > 0) {
    notes.push(
      `searches ~${formatCost(cost.search.estimatedUSD)} (${String(cost.search.searches)}${cost.search.unpriced > 0 ? `, ${String(cost.search.unpriced)} unpriced` : ""})`,
    );
  }
  if (cost.unpricedSteps > 0) {
    notes.push(`${String(cost.unpricedSteps)} steps unpriced`);
  }
  if (cost.unmeteredSteps > 0) {
    notes.push(
      `${String(cost.unmeteredSteps)} stopped steps reported no usage`,
    );
  }
  const line = [pieces.join(" + "), ...notes].filter(Boolean).join(", ");
  return line === "" ? undefined : line;
}

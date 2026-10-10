import { z } from "zod";

import {
  AIUsageFilterSchema,
  AIUsageRowSchema,
  AIUsageSortSchema,
} from "../../lib/ai-usage/schema";
import {
  getAIUsage,
  listAIUsage,
  summarizeAIUsage,
} from "../../lib/ai-usage/store";
import { chatById } from "../../lib/chat/chats";
import { ChatIdSchema } from "../../schemas/chat-id";
import { base } from "../base";

/** A row with its chat's name, which is absent once the chat is gone. */
const AIUsageListedSchema = AIUsageRowSchema.extend({
  chatTitle: z.string().nullable(),
});

/** Each chat's title by id, for the chats a page names; none for one that no longer exists. */
async function chatTitles(chatIds: Iterable<null | string>) {
  const titles = new Map<string, null | string>();
  for (const id of new Set(chatIds)) {
    if (id === null) {
      continue;
    }
    const parsed = ChatIdSchema.safeParse(id);
    const chat = parsed.success ? await chatById(parsed.data) : undefined;
    titles.set(id, chat?.title ?? null);
  }
  return titles;
}

/** One page of the log under the filters, in the order asked for. */
const list = base
  .input(
    z.object({
      filter: AIUsageFilterSchema,
      limit: z.number().int().min(1).max(500),
      offset: z.number().int().min(0),
      sort: AIUsageSortSchema,
    }),
  )
  .output(AIUsageListedSchema.array())
  .handler(async ({ input }) => {
    const rows = listAIUsage(input);
    const titles = await chatTitles(rows.map((row) => row.chatId));
    return rows.map((row) => ({
      ...row,
      chatTitle: row.chatId ? (titles.get(row.chatId) ?? null) : null,
    }));
  });

/** One request, for its detail page. */
const byId = base
  .input(z.object({ id: z.string() }))
  .output(AIUsageListedSchema.optional())
  .handler(async ({ input }) => {
    const row = getAIUsage(input.id);
    if (!row) {
      return undefined;
    }
    const titles = await chatTitles([row.chatId]);
    return {
      ...row,
      chatTitle: row.chatId ? (titles.get(row.chatId) ?? null) : null,
    };
  });

const FacetValueSchema = z.object({
  count: z.number(),
  /** A chat's title for an origin that is a chat, when the chat still exists. */
  label: z.string().nullable(),
  value: z.string(),
});

/** The totals under the filters, and the values each filter can take with their counts. */
const summary = base
  .input(z.object({ filter: AIUsageFilterSchema }))
  .output(
    z.object({
      facets: z.record(z.string(), FacetValueSchema.array()),
      requests: z.number(),
      tokens: z.number(),
    }),
  )
  .handler(async ({ input }) => {
    const { facets, requests, tokens } = summarizeAIUsage(input.filter);
    const titles = await chatTitles(
      facets.origin.map(({ value }) =>
        value.startsWith("chat:") ? value.slice("chat:".length) : null,
      ),
    );
    return {
      facets: Object.fromEntries(
        Object.entries(facets).map(([facet, values]) => [
          facet,
          values.map((entry) => ({
            ...entry,
            label: entry.value.startsWith("chat:")
              ? (titles.get(entry.value.slice("chat:".length)) ?? null)
              : null,
          })),
        ]),
      ),
      requests,
      tokens,
    };
  });

export const aiUsage = { byId, list, summary };

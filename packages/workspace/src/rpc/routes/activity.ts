import { z } from "zod";

import {
  ActivityFilterSchema,
  ActivityRowSchema,
  ActivitySortSchema,
} from "../../lib/activity/schema";
import { getActivity, listActivity } from "../../lib/activity/store";
import { chatById } from "../../lib/chat/chats";
import { ChatIdSchema } from "../../schemas/chat-id";
import { base } from "../base";

/** A row with its chat's name, which is absent once the chat is gone. */
const ActivityListedSchema = ActivityRowSchema.extend({
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
      filter: ActivityFilterSchema,
      limit: z.number().int().min(1).max(500),
      offset: z.number().int().min(0),
      sort: ActivitySortSchema,
    }),
  )
  .output(ActivityListedSchema.array())
  .handler(async ({ input }) => {
    const rows = await listActivity(input);
    const titles = await chatTitles(rows.map((row) => row.chatId));
    return rows.map((row) => ({
      ...row,
      chatTitle: row.chatId ? (titles.get(row.chatId) ?? null) : null,
    }));
  });

/** One request, for its detail page. */
const byId = base
  .input(z.object({ id: z.string() }))
  .output(ActivityListedSchema.optional())
  .handler(async ({ input }) => {
    const row = await getActivity(input.id);
    if (!row) {
      return undefined;
    }
    const titles = await chatTitles([row.chatId]);
    return {
      ...row,
      chatTitle: row.chatId ? (titles.get(row.chatId) ?? null) : null,
    };
  });

export const activity = { byId, list };

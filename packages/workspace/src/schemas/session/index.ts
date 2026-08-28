import { z } from "zod";

import { StoreId } from "../store-id";
import { SessionMessage } from "./message";

export namespace Session {
  export const Schema = z.object({
    createdAt: z.date(),
    id: StoreId.SessionSchema,
    parentId: StoreId.SessionSchema.optional(),
    /**
     * The last message of the conversation before its context window was reset.
     *
     * Everything up to and including it stays on disk and stays in the
     * transcript; assembly stops sending the model's half of it. Absent on a
     * session that has never rolled over, which is the overwhelming majority.
     * A single id is enough for repeated rollovers because each boundary sits
     * after the last, so the newest one already describes every earlier reset.
     */
    rolledOverAfterMessageId: StoreId.MessageSchema.optional(),
    title: z.string(),
    updatedAt: z.date().optional(),
  });

  export type Type = z.output<typeof Session.Schema>;

  export const WithMessagesAndPartsSchema = Schema.extend({
    messages: z.array(SessionMessage.WithPartsSchema),
  });

  export type WithMessagesAndParts = z.output<
    typeof WithMessagesAndPartsSchema
  >;
}

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
    /**
     * The usable window in force when that boundary was drawn.
     *
     * Recorded so the boundary can be retired when it stops applying: a reset
     * taken because a small model had no room says nothing about a large one,
     * and without the window it was decided under there is no way to tell that
     * the constraint has gone. Stored as the usable window rather than the
     * model's full one because that is the number the decision was actually
     * made against, reserve already subtracted.
     *
     * Absent on a boundary drawn before this was kept, and on one drawn for a
     * model whose window was never reported. Both mean the same thing to a
     * reader: this boundary cannot be judged, so it stands.
     */
    rolledOverUnderUsableTokens: z.number().int().positive().optional(),
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

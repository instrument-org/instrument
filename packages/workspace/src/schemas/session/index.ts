import { z } from "zod";

import { StoreId } from "../store-id";
import { SessionMessage } from "./message";

export namespace Session {
  export const Schema = z.object({
    /** When the chat was put away; absent while it is in the inbox. */
    archivedAt: z.date().optional(),
    createdAt: z.date(),
    /**
     * On a task, the last of its parent's messages it carries on from. Its
     * history is read rather than copied: the parent's messages up to and
     * including this one, then its own, so its first request sends the
     * prefix the parent's last request did.
     */
    forkedAtMessageId: StoreId.MessageSchema.optional(),
    /**
     * A task's short name in its chat, `t1`, `t2`, … in the order the chat
     * started them: what the `task` command takes. Given once, when the task
     * is started, and never changed. Absent on the chat's own session.
     */
    handle: z.string().optional(),
    id: StoreId.SessionSchema,
    /**
     * The session a task was started from: its chat's conversation. Absent on
     * the chat's own session.
     */
    parentId: StoreId.SessionSchema.optional(),
    /** When the user starred the chat; absent while it is not starred. */
    starredAt: z.date().optional(),
    /**
     * Since when the chat has had something the user has not looked at: set
     * as the chat settles (a reply, a question, or a turn that ended in an
     * error) and by the user marking it unread, and taken off once they have
     * looked. Absent while the chat is read.
     */
    unreadAt: z.date().optional(),
    /**
     * Whether the user marked the chat unread themselves. Such a mark holds
     * while they stay on the chat it was set from, and clears only when they
     * come back to it; a mark the chat set clears as soon as it is seen.
     */
    unreadByUser: z.boolean().optional(),
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
    /**
     * Where a task stood when its last turn ended, or `running` while one is
     * under way. Whether one is under way this moment is the session's
     * agent's to say: a `running` with no agent alive is a turn the app quit
     * in. Absent on the chat's own session.
     */
    status: z.enum(["done", "failed", "running", "waiting"]).optional(),
    title: z.string(),
    /**
     * When the chat's title stopped being the app's to change: its one
     * automatic rename, once its first exchange settled, or the user naming
     * it, by hand or from the conversation. After it, only the user renames
     * the chat.
     */
    titleSettledAt: z.date().optional(),
    /**
     * The topics this chat is tagged with, by topic id. On the chat's own
     * record so the chat list is one read and a filter is a predicate over
     * it; a task's ordinary sessions never carry any.
     */
    topics: z.array(z.string()).optional(),
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

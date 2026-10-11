import {
  AIGatewayModelURI,
  REASONING_EFFORTS,
} from "@instrument-org/ai-gateway";
import { z } from "zod";

import { AbsolutePathSchema } from "./paths";
import { StoreId } from "./store-id";

/**
 * A folder this chat may use, read and write, made in the chat and good in
 * it alone. "card" is an allow from a permission card (or `task folder
 * --add`), "attached" a folder the user sent with a message. Where it mounts
 * is derived from its path and when it was granted (folder-reach.ts), never
 * stored.
 */
const ChatGrantSchema = z.object({
  grantedAt: z.coerce.date(),
  path: AbsolutePathSchema,
  source: z.enum(["attached", "card"]),
});

export type ChatGrant = z.output<typeof ChatGrantSchema>;

// Load-bearing that this stays a plain object schema: it is parsed against the
// whole settings file, whose `state` key it is meant to ignore rather than
// reject. Making it strict would fail every chat's settings at once, and with
// them the session each chat names.
export const ChatSettingsSchema = z.object({
  // The chat's own conversation: the session in its `chat.db` with no parent.
  // A chat's folder is named for what it is about, so this is how a session
  // finds its chat. Whether a folder is a chat is where it is
  // (record-folders.ts), never a field here.
  chatSessionId: StoreId.SessionSchema.optional(),
  // When the chat was made, recorded for the same reason as
  // `lastActivityAt`: the observable answer is the database's birth time,
  // which is when the chat was first opened, and for an imported chat it is
  // when the copy happened.
  createdAt: z.coerce.date().optional(),
  createdWithAppVersion: z.string().optional(),
  // The folders granted in this chat, oldest first. One that will not parse
  // costs the chat its grants rather than the rest of its settings.
  grants: z.array(ChatGrantSchema).optional().catch(undefined),
  // When something happened in this chat, as opposed to when a file under it
  // was last written. It orders the chat list, and it is recorded rather than
  // observed because the observable timestamps do not mean what the list needs:
  // the database is rewritten by the act of opening a chat, so sorting on its
  // mtime moves a chat to the top for having been read.
  lastActivityAt: z.coerce.date().optional(),
  // The model every session of the chat runs on, its tasks' included: the
  // one the composer last sent with. A URI this build cannot parse (a
  // provider since renamed or removed) reads as none, so the chat opens on
  // the default model rather than failing to open.
  modelURI: AIGatewayModelURI.Schema.optional().catch(undefined),
  // How hard the chat's model is asked to think, on every turn any of its
  // sessions takes. Absent leaves the model's own default. Nothing picks it
  // yet; a picker would write it here.
  reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
});

export const ChatSettingsUpdateSchema = ChatSettingsSchema.partial().extend({
  lastActivityAt: z.coerce.date().optional(),
});

export type ChatSettings = z.output<typeof ChatSettingsSchema>;
export type ChatSettingsUpdate = z.output<typeof ChatSettingsUpdateSchema>;

import { z } from "zod";

import { StoreId } from "./store-id";

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
  // The name this chat's own folder was last given under `Chats/`, which is
  // the app's whole hold on that folder: the folder is found by this name and
  // never by what is inside it, so a folder moved out of `Chats/` is not
  // followed, and the chat's next change makes a fresh one under its current
  // title. A folder renamed in place is followed by the launch sweep, which
  // writes the name the person gave it here (chat-folders/sweep.ts).
  // References to what the person pasted are stored relative to the folder,
  // so a rename breaks none of them.
  folder: z.string().min(1).optional().catch(undefined),
  // When something happened in this chat, as opposed to when a file under it
  // was last written. It orders the chat list, and it is recorded rather than
  // observed because the observable timestamps do not mean what the list needs:
  // the database is rewritten by the act of opening a chat, so sorting on its
  // mtime moves a chat to the top for having been read.
  lastActivityAt: z.coerce.date().optional(),
});

export const ChatSettingsUpdateSchema = ChatSettingsSchema.partial();

export type ChatSettings = z.output<typeof ChatSettingsSchema>;
export type ChatSettingsUpdate = z.output<typeof ChatSettingsUpdateSchema>;

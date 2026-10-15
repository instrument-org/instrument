import { z } from "zod";

import { type StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { ChatReads } from "./chat-reads";
import { ChatWrites } from "./chat-writes";

/** The granted folders a session was last told of, by path. */
const FoldersBaselineSchema = z.array(z.object({ path: z.string() }));

type FoldersBaseline = z.output<typeof FoldersBaselineSchema>;

/** Reads the session's folders baseline, or undefined when none is stored yet. */
export function getFoldersBaseline(chatId: ChatId, sessionId: StoreId.Session) {
  return ChatReads.told({
    chatId,
    schema: FoldersBaselineSchema,
    sessionId,
    what: "folders",
  });
}

/** Persists the folders baseline for the session. */
export function setFoldersBaseline(
  chatId: ChatId,
  sessionId: StoreId.Session,
  folders: FoldersBaseline,
) {
  return ChatWrites.told(chatId, sessionId, "folders", folders);
}

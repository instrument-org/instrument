import { sort, unique } from "radashi";

import { type StoreId } from "../../schemas/store-id";
import { type ChatId } from "../../schemas/chat-id";
import { pathsNamedInMessage } from "../paths-named-in-message";
import { sessionOfChat } from "../record-folders";
import { Store } from "../store";
import { type Derived, indexedByStore, kept, unkept } from "../workspace-index";
import { listChatIds } from "./chat-records";

/**
 * How far back into a chat this reads. A file the conversation handed over
 * a hundred messages ago is history rather than a recent, and the point of a
 * bound is that a chat a year old costs the same to ask as a new one.
 */
const MESSAGES_READ = 100;

/** A file the conversation showed the user, and when it showed it. */
export interface LinkedFile {
  at: number;
  /** The chat whose reply named it, which is what a path under `/task` is relative to. */
  chatId: ChatId;
  /** The path as the reply named it, which is the path the agent can reach it by. */
  path: string;
}

/**
 * The files the conversation has put on screen, newest first.
 *
 * What the agent chose to show is the whole of it: a `files` fence or a link
 * to a path, the two things a reply draws as something to open. Read back out
 * of what was said rather than recorded as it happened, so it needs nothing
 * kept up to date and says the same thing after a restart. Every chat is
 * asked, since the user saw all of them.
 *
 * A path here is what the user was shown, not a promise that anything is still
 * there; the file may have been moved or thrown away since.
 */
export async function linkedFiles(): Promise<LinkedFile[]> {
  const shown = await Promise.all(
    listChatIds().flatMap((chatId) => {
      const sessionId = sessionOfChat(chatId);
      return sessionId ? [shownIn(chatId, sessionId)] : [];
    }),
  );
  // Newest first, then one entry per file a chat named: a file handed over
  // again is the same file, and the time that matters is the last time it was
  // shown. The same path named in two chats can be two files, so which chat
  // named it is part of what makes it one.
  return unique(
    sort(shown.flat(), (file) => file.at, true),
    (file) => `${file.chatId}\0${file.path}`,
  );
}

/** What each chat's replies showed, kept until its store changes. */
const shownByChat = indexedByStore<LinkedFile[]>("linked_files");

async function readShownIn(
  chatId: ChatId,
  sessionId: StoreId.Session,
): Promise<Derived<LinkedFile[]>> {
  const ids = await Store.getMessageIds(sessionId, chatId);
  if (ids.isErr()) {
    return unkept([]);
  }
  const messages = await Store.getMessagesWithParts({
    messageIds: ids.value.slice(-MESSAGES_READ),
    sessionId,
    chatId,
  });
  if (messages.isErr()) {
    return unkept([]);
  }
  return kept(
    messages.value.flatMap((message) =>
      message.role === "assistant"
        ? [...pathsNamedInMessage(message)].map((path) => ({
            at: message.metadata.createdAt.getTime(),
            chatId,
            path,
          }))
        : [],
    ),
  );
}

/** What one chat's replies showed. */
function shownIn(
  chatId: ChatId,
  sessionId: StoreId.Session,
): Promise<LinkedFile[]> {
  return shownByChat(chatId, () => readShownIn(chatId, sessionId));
}

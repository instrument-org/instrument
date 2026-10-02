import { sort } from "radashi";

import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { listChats } from "./chats";
import { listTopics } from "./topics";

/** How many of the other chats a new chat's agent is told about. */
const CHATS_IN_CONTEXT = 12;

/**
 * What a new chat is told about the others: the ones that moved most
 * recently, newest first, each by its id, its title, its topic names, its
 * latest line, and when it last moved. Read at the moment the chat opens and
 * stored on its root, so the note is the same every time the transcript is
 * rebuilt.
 */
export async function chatContextFor(): Promise<SessionMessageDataPart.ChatContextDataPart> {
  const [chats, topics] = await Promise.all([listChats(), listTopics()]);
  const names = new Map(topics.map((topic) => [topic.id, topic.name]));
  return {
    chats: sort(chats, (chat) => chat.updatedAt, true)
      .slice(0, CHATS_IN_CONTEXT)
      .map((chat) => ({
        at: chat.updatedAt,
        id: chat.id,
        ...(chat.latest ? { latest: chat.latest.text } : {}),
        title: chat.title,
        topics: chat.topics.flatMap((id) => {
          const name = names.get(id);
          return name ? [name] : [];
        }),
      })),
    sentAt: Date.now(),
  };
}

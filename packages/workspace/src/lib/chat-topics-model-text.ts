import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

/**
 * Tells the agent which topics this chat is filed under: each one's name,
 * its mark, and the line saying what belongs there. Rendered only when it
 * differs from the last note, so a chat tagged once is told once.
 */
export function chatTopicsModelNote(
  data: SessionMessageDataPart.ChatTopicsDataPart,
) {
  if (data.topics.length === 0) {
    return systemNote`
      This chat has no topics now.
    `;
  }
  const named = data.topics
    .map((topic) => {
      const mark = topic.emoji ? `${topic.emoji} ` : "";
      const about = topic.about ? ` (${topic.about})` : "";
      return `${mark}"${topic.name}"${about}`;
    })
    .join(", ");
  return systemNote`
    This chat is filed under the ${data.topics.length === 1 ? "topic" : "topics"} ${named}. Topics are tags the user puts on chats to find them by; read the chat through them.
  `;
}

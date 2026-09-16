import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

/**
 * Tells the agent which topics this thread is filed under: each one's name,
 * its mark, and the line saying what belongs there. Rendered only when it
 * differs from the last note, so a thread tagged once is told once.
 */
export function threadTopicsModelNote(
  data: SessionMessageDataPart.ThreadTopicsDataPart,
) {
  if (data.topics.length === 0) {
    return systemNote`
      This thread has no topics now.
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
    This thread is filed under the ${data.topics.length === 1 ? "topic" : "topics"} ${named}. Topics are tags the user puts on threads to find them by; read the thread through them.
  `;
}

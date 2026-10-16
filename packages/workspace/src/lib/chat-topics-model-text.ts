import { TOPIC_FILE_NAME, TOPICS_FOLDER_NAME } from "../constants";
import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { instructionsInContext } from "./instructions-in-context";
import { systemNote } from "./system-note";

/**
 * Tells the agent which topics this chat is filed under: each one's name,
 * its mark, and the line saying what belongs there, then each one's
 * instructions and folders. Rendered only when it differs from the last
 * note, so a chat tagged once is told once, and told again when the user
 * changes a topic's instructions or folders.
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
  const standing = data.topics.flatMap((topic) => {
    const instructions = instructionsInContext({
      file: `${TOPICS_FOLDER_NAME}/${topic.name}/${TOPIC_FILE_NAME}`,
      instructions: topic.instructions,
    });
    return [
      ...(instructions
        ? [
            `The user's instructions for every chat under "${topic.name}":\n<topic_instructions>\n${instructions}\n</topic_instructions>`,
          ]
        : []),
      ...(topic.folders?.length
        ? [
            `Folders the work under "${topic.name}" uses, attached to this chat: ${topic.folders.join(", ")}. Hand a task the ones its work needs.`,
          ]
        : []),
    ];
  });
  return systemNote`
    This chat is filed under the ${data.topics.length === 1 ? "topic" : "topics"} ${named}. Topics are tags the user puts on chats to find them by; read the chat through them.${standing.length > 0 ? `\n\n${standing.join("\n\n")}` : ""}
  `;
}

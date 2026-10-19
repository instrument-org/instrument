import { TOPIC_FILE_NAME, TOPICS_FOLDER_NAME } from "../constants";
import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { instructionsInContext } from "./instructions-in-context";
import { systemNote } from "./system-note";

/**
 * Tells the agent which topic this chat is filed under: its name, its mark,
 * and the line saying what belongs there, then its instructions and
 * folders. Rendered only when it differs from the last note, so a chat
 * filed once is told once, and told again when the user changes the
 * topic's instructions or folders.
 */
export function topicModelNote({
  topic,
}: SessionMessageDataPart.TopicDataPart) {
  if (topic === null) {
    return systemNote`
      This chat has no topic now.
    `;
  }
  const mark = topic.emoji ? `${topic.emoji} ` : "";
  const about = topic.about ? ` (${topic.about})` : "";
  const instructions = instructionsInContext({
    file: `${TOPICS_FOLDER_NAME}/${topic.name}/${TOPIC_FILE_NAME}`,
    instructions: topic.instructions,
  });
  const standing = [
    ...(instructions
      ? [
          `The user's instructions for every chat under "${topic.name}":\n<topic_instructions>\n${instructions}\n</topic_instructions>`,
        ]
      : []),
    ...(topic.folders?.length
      ? [
          `Folders the work under "${topic.name}" uses, attached to this chat: ${topic.folders.map((folder) => `\`${folder}\``).join(", ")}.`,
        ]
      : []),
  ];
  return systemNote`
    This chat is filed under the topic ${mark}"${topic.name}"${about}. Topics are tags the user puts on chats to find them by; read the chat through it.${standing.length > 0 ? `\n\n${standing.join("\n\n")}` : ""}
  `;
}

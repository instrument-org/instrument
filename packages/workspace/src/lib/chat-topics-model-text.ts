import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

/** How much of a topic's instructions the agent is given, the same budget a 1.x project had. */
const TOPIC_INSTRUCTIONS_MAX = 20_000;

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
    const instructions = topicInstructions(topic.instructions);
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

/**
 * A topic's instructions as the agent is given them: trimmed, and cut on a
 * paragraph break past the budget, saying so.
 */
function topicInstructions(instructions: string | undefined) {
  const trimmed = instructions?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length <= TOPIC_INSTRUCTIONS_MAX) {
    return trimmed;
  }
  const within = trimmed.slice(0, TOPIC_INSTRUCTIONS_MAX);
  const lastBreak = within.lastIndexOf("\n\n");
  const kept = lastBreak > 0 ? within.slice(0, lastBreak) : within.trimEnd();
  return `${kept}\n\n[Cut off here: the rest of these instructions is too long to include.]`;
}

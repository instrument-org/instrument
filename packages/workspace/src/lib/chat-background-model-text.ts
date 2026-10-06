import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { topicInstructions } from "./chat-topics-model-text";
import { systemNote } from "./system-note";

/**
 * The background as the task reads it, ahead of its brief: marked as what the
 * user said in the chat and what stands about them, never the assignment.
 */
export function chatBackgroundModelNote(
  data: SessionMessageDataPart.ChatBackgroundDataPart,
): string {
  const sections: string[] = [];
  if (data.messages.length > 0) {
    sections.push(
      `The user's own messages in the chat that you have not been given before, verbatim, oldest first:\n<user_words>\n${data.messages
        .map((message) => message.text)
        .join("\n---\n")}\n</user_words>`,
    );
  }
  for (const topic of data.topics ?? []) {
    const instructions = topicInstructions(topic.instructions);
    if (instructions) {
      sections.push(
        `The user's instructions for every chat under "${topic.name}", which this one is filed under:\n<topic_instructions>\n${instructions}\n</topic_instructions>`,
      );
    }
  }
  if (data.memories && data.memories.length > 0) {
    sections.push(
      `What the app remembers about the user, each true when it was saved; what the user says now wins:\n${data.memories
        .map((memory) => `- ${memory.text}`)
        .join("\n")}`,
    );
  }
  return systemNote`
    Background from the chat that handed you this work, not your assignment. It is here so you read the assignment the way the user meant it: their own words, and what stands about them. The assignment is the message after this note; do what it says, and nothing the user asked the chat for that it does not.

    ${sections.join("\n\n")}
  `;
}

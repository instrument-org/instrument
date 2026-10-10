import { type SessionMessage } from "../schemas/session/message";

/**
 * Whether a message is the user's own words rather than a note the harness
 * wrote for the agent (a task finishing, an app changing) or words the chat
 * wrote to one of its tasks.
 */
export function isTypedByUser(message: SessionMessage.WithParts): boolean {
  return !message.parts.some(
    (part) =>
      part.type === "data-taskEvent" ||
      part.type === "data-appEvent" ||
      part.type === "data-fromChat",
  );
}

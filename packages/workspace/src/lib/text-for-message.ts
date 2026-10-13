import { type SessionMessage } from "../schemas/session/message";

/**
 * What the user typed, and nothing else.
 *
 * Deliberately blind to attachments. Anything naming a message's files or
 * folders has to say so itself, at its own call site, so a helper this generic
 * can never be the route by which a folder's location reaches the model
 * without the check on whether the agent may reach it.
 */
export function textForMessage(message: SessionMessage.WithParts) {
  return message.parts
    .flatMap((part) => {
      switch (part.type) {
        case "text": {
          return [part.text];
        }
        default: {
          return [];
        }
      }
    })
    .join("\n");
}

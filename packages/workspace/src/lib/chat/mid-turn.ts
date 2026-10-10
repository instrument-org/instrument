import { type SessionMessage } from "../../schemas/session/message";
import { systemNote } from "../system-note";

/**
 * A message the user typed while the chat's turn was working joins that turn
 * at its next step rather than stopping it: nearly always it is more of the
 * same request (a detail, a correction, one more thing), and the turn is the
 * one agent that knows what it was doing. The turn decides what the message
 * is; one about something else gets its answer, with the work handed to a
 * task when it still has a way to go.
 *
 * A message that calls the work off is the exception, and stops the turn at
 * once.
 */
const CALLS_IT_OFF =
  /^\W*(?:stop|cancel|abort|halt|never\s*mind|forget (?:it|that))\b/i;

/** Whether a message the user sent mid-turn calls the turn's work off. */
export function callsItOff(message: SessionMessage.UserWithParts): boolean {
  return CALLS_IT_OFF.test(
    message.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n")
      .trim(),
  );
}

/** Said beside a message that joined the turn it arrived during. */
export const MID_TURN_NOTE = systemNote`
  The user sent this while you were working on their last message.
`.trim();

/** Whether a message joined the turn it arrived during. */
export function joinedMidTurn(message: SessionMessage.WithParts): boolean {
  return message.parts.some(
    (part) =>
      part.type === "data-intent" && part.data.text.includes(MID_TURN_NOTE),
  );
}

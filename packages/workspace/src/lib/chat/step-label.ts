import { type SessionMessage } from "../../schemas/session/message";
import { isToolPart } from "../is-tool-part";
import { isStillArriving } from "../transcript/transcript-message";

/** How much of a step's label the conversation shows. */
const STEP_MAX_LENGTH = 80;

/**
 * The line a task at work is read by: the phase its newest call belongs to,
 * or that call's explanation when it named none. The phase comes first
 * because it changes once every few calls and says why the work is
 * happening, where the explanation changes on every call.
 *
 * A call still streaming in is read from the turn's own memory as its input
 * arrives, so a field would show a word at a time. A field counts once
 * another has started after it (`isStillArriving`, the rule the transcript's
 * rows read a call by too); until then the line reads the call's other
 * field, or stays on the call before.
 */
export function latestStepIn(
  messages: SessionMessage.WithParts[],
): string | undefined {
  for (const message of messages.toReversed()) {
    if (message.role !== "assistant") {
      continue;
    }
    for (const part of message.parts.toReversed()) {
      if (!isToolPart(part)) {
        continue;
      }
      const input: unknown = part.input;
      if (typeof input !== "object" || input === null) {
        continue;
      }
      const label =
        "activity" in input &&
        typeof input.activity === "string" &&
        input.activity.trim() &&
        !isStillArriving(part, "activity")
          ? input.activity
          : "explanation" in input &&
              typeof input.explanation === "string" &&
              !isStillArriving(part, "explanation")
            ? input.explanation
            : undefined;
      if (label?.trim()) {
        return label.length > STEP_MAX_LENGTH
          ? `${label.slice(0, STEP_MAX_LENGTH)}…`
          : label;
      }
    }
  }
  return undefined;
}

import { type SessionMessage } from "../../schemas/session/message";
import { isToolPart } from "../is-tool-part";

/** How much of a step's label the conversation shows. */
const STEP_MAX_LENGTH = 80;

/**
 * The line a task at work is read by: the phase its newest call belongs to,
 * or that call's explanation when it named none. The phase comes first
 * because it changes once every few calls and says why the work is
 * happening, where the explanation changes on every call.
 *
 * A call still streaming in is saved as its input arrives, and the activity
 * is written first, so a new phase would show a word at a time. Its activity
 * counts once another field has started after it; until then the line stays
 * on the call before.
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
      const isActivityComplete =
        part.state !== "input-streaming" ||
        Object.keys(input).some((key) => key !== "activity");
      const label =
        "activity" in input &&
        typeof input.activity === "string" &&
        input.activity.trim() &&
        isActivityComplete
          ? input.activity
          : "explanation" in input && typeof input.explanation === "string"
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

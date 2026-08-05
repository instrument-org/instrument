import { type SessionMessage } from "../schemas/session/message";
import { textForMessage } from "./text-for-message";

const MAX_CHARS = 50;

/**
 * The name a task carries until a generated title replaces it, and keeps for
 * good when nothing generates one. Cut at a word boundary rather than mid-word:
 * this is a title a user may live with, not a preview.
 */
export function defaultTaskName(
  source: SessionMessage.WithParts | string,
): string {
  const text = (
    typeof source === "string" ? source : textForMessage(source)
  ).trim();

  if (text.length <= MAX_CHARS) {
    return text;
  }

  const cut = text.slice(0, MAX_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  // A single word longer than the budget has no boundary to cut on.
  const truncated = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return `${truncated.trimEnd()}…`;
}

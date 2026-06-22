import { type SessionMessage } from "../schemas/session/message";
import { textForMessage } from "./text-for-message";

const MAX_CHARS = 50;

export function defaultTaskName(
  source: SessionMessage.WithParts | string,
): string {
  const text = (
    typeof source === "string" ? source : textForMessage(source)
  ).trim();

  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}…` : text;
}

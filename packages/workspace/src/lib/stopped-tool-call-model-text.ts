import { STOPPED_TOOL_CALL_ERROR_TEXT } from "../constants";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { isToolPart } from "./is-tool-part";

/**
 * A call a stop cut off, as the model reads it: who stopped it, and that a
 * stop is a decision rather than a failure to retry. The stored words are the
 * person's ("stopped by you"), which a model reading "you" as itself, or as
 * nobody in particular, took as leave to run the call again on the user's
 * next message, however unrelated. Any other part passes through.
 */
export function withStoppedToolCallModelText(
  part: SessionMessagePart.Type,
): SessionMessagePart.Type {
  if (
    !isToolPart(part) ||
    part.state !== "output-error" ||
    part.errorText !== STOPPED_TOOL_CALL_ERROR_TEXT
  ) {
    return part;
  }
  return {
    ...part,
    errorText:
      part.metadata.stoppedBy === "chat"
        ? "The conversation that started this task stopped this. Do not run it again unless it asks."
        : "The user stopped this. Do not run it again unless they ask.",
  };
}

import { STOPPED_TOOL_CALL_ERROR_TEXT } from "../constants";
import { SessionMessagePart } from "../schemas/session/message-part";
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
      part.metadata.stoppedBy === "agent"
        ? "The conversation that started this task stopped this. Do not run it again unless it asks."
        : "The user stopped this. Do not run it again unless they ask.",
  };
}

/**
 * A call of ours the record left without a result, answered as the model
 * reads it: a request needs every call answered, and leaving the call out
 * would lose the model's record of having made it. Only a turn that ended
 * without settling its calls leaves one (stopped outright, or a process
 * that is gone), and the answer says so. A call the output limit cut off is
 * never one of these: the request answers it as it ends. A call the
 * provider ran is the provider's to answer, so it passes through, as does
 * every other part.
 */
export function withUnansweredToolCallResult(
  part: SessionMessagePart.Type,
): SessionMessagePart.Type {
  if (
    !isToolPart(part) ||
    part.providerExecuted === true ||
    (part.state !== "input-available" && part.state !== "input-streaming")
  ) {
    return part;
  }
  return SessionMessagePart.coerce({
    ...part,
    errorText:
      "This call was stopped before it returned: it never ran, or was interrupted while it ran.",
    state: "output-error",
  });
}

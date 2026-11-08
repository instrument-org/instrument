import { type ModelMessage } from "ai";

import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { isToolPart } from "./is-tool-part";

/** A call of the step that started a task, as the task reads its result. */
interface HandOffResult {
  text: string;
  /** The call's id as the provider gave it, which its part stands in for while converting. */
  toolCallId: string;
}

/**
 * Notes the chat's run writes onto its turn's last step after the fact,
 * which a task forked at that step would otherwise hear as its own.
 */
const CHAT_TURN_PARTS = new Set<SessionMessagePart.Type["type"]>([
  "data-maxSteps",
  "data-outputLimit",
  "data-setupChanges",
]);

/**
 * A task's history with the chat's step that started it read for the task:
 * the call that started it says so, by its handle, every other call in the
 * step is the chat's, and the notes the chat's turn left on the step are
 * left out. Without the step, the user's message it answered reads as still
 * unanswered, and a task took the request for its own and made the chat's
 * calls again. Written from the stored assignment alone, never from what the
 * chat's calls returned or what its turn wrote since, so the task reads the
 * step the same on every request.
 *
 * Each of the step's calls goes through conversion under its part's id,
 * which no other call has, and `withHandOffResults` gives each its own id
 * back with its result: a provider that reuses call ids (`functions.bash:0`)
 * would otherwise have other calls of that id read as the hand-off.
 */
export function withHandOffCalls(messages: SessionMessage.WithParts[]): {
  messages: SessionMessage.WithParts[];
  results: Map<string, HandOffResult>;
} {
  const results = new Map<string, HandOffResult>();
  const call = messages
    .flatMap((message) => message.parts)
    .flatMap((part) =>
      part.type === "data-fromChat" &&
      part.data.kind === "assignment" &&
      part.data.call !== undefined
        ? [part.data.call]
        : [],
    )
    .at(0);
  if (call === undefined) {
    return { messages, results };
  }
  return {
    messages: messages.map((message) => {
      if (!message.parts.some((part) => part.metadata.id === call.partId)) {
        return message;
      }
      return {
        ...message,
        parts: message.parts
          .filter((part) => !CHAT_TURN_PARTS.has(part.type))
          .map((part) => {
            if (!isToolPart(part) || part.providerExecuted === true) {
              return part;
            }
            results.set(part.metadata.id, {
              text:
                part.metadata.id === call.partId
                  ? `Started task ${call.handle}. That is you: the conversation goes on without you, and the rest of this step is its own. Your assignment follows.`
                  : "The conversation made this call in the step that started you, and has its result.",
              toolCallId: part.toolCallId,
            });
            // A part id is a call id as the AI SDK reads one: an opaque string.
            return { ...part, toolCallId: part.metadata.id };
          }),
      };
    }),
    results,
  };
}

/** The model messages with the step's calls given their own ids back, and their results as `results` says. */
export function withHandOffResults(
  messages: ModelMessage[],
  results: ReadonlyMap<string, HandOffResult>,
): ModelMessage[] {
  if (results.size === 0) {
    return messages;
  }
  return messages.map((message) => {
    if (message.role === "assistant" && typeof message.content !== "string") {
      return {
        ...message,
        content: message.content.map((part) => {
          const found =
            part.type === "tool-call"
              ? results.get(part.toolCallId)
              : undefined;
          return found === undefined
            ? part
            : { ...part, toolCallId: found.toolCallId };
        }),
      };
    }
    if (message.role !== "tool") {
      return message;
    }
    return {
      ...message,
      content: message.content.map((part) => {
        const found =
          part.type === "tool-result"
            ? results.get(part.toolCallId)
            : undefined;
        return found === undefined
          ? part
          : {
              ...part,
              output: { type: "text" as const, value: found.text },
              toolCallId: found.toolCallId,
            };
      }),
    };
  });
}

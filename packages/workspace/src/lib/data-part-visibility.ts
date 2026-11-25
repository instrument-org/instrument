import { SessionMessageDataPart } from "../schemas/session/message-data-part";
import { type SessionMessagePart } from "../schemas/session/message-part";

export type DataPartVisibility = SessionMessageDataPart.Shown;

/**
 * A part kept for a developer alone. It is not content: a message holding only
 * this one is as empty as it was, and writing it is no activity of the session's.
 */
export function isDeveloperNotePart({ type }: { type: string }): boolean {
  return type === "data-requestFailure" || type === "data-requestNote";
}

/** How a data part surfaces in the chat: as its kind does, or not at all. */
export function dataPartVisibility(
  part: SessionMessagePart.DataPart,
): DataPartVisibility {
  // A card the person closed is gone from the chat.
  if (part.type === "data-ratingCard" && part.data.outcome === "dismissed") {
    return "hidden";
  }
  return SessionMessageDataPart.kindOf(part.type)?.shown ?? "hidden";
}

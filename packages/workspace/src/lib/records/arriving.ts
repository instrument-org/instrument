import { type SessionMessagePart } from "../../schemas/session/message-part";
import { isToolPart } from "../is-tool-part";

/**
 * Whether a part is still arriving, which is never a record: text or
 * reasoning being streamed, a call whose input is still being typed, the
 * preliminary output a tool gave before its own, the facts of a shell call
 * still running, and a summary being written. The turn holds these in
 * memory, where every read of the chat sees them, and the snapshot that
 * settles one is what gets written.
 */
export function isArriving(part: SessionMessagePart.Type): boolean {
  if (isToolPart(part)) {
    return part.state === "input-streaming" || part.preliminary === true;
  }
  // Only ever a mark on the turn while it lasts; nothing settles it.
  if (part.type === "data-summarizing") {
    return true;
  }
  // A shell call's facts rise while it runs, and are written once it ends.
  if (part.type === "data-stepFacts") {
    return !part.data.settled;
  }
  return (
    (part.type === "text" || part.type === "reasoning") &&
    part.state === "streaming"
  );
}

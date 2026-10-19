import { type SessionMessagePart } from "../../schemas/session/message-part";
import { isToolPart } from "../is-tool-part";

/**
 * Whether a part is still arriving, which is never a record: text or
 * reasoning being streamed, a call whose input is still being typed, and the
 * preliminary output a tool gave before its own. The turn holds these in
 * memory, where every read of the chat sees them, and the snapshot that
 * settles one is what gets written.
 */
export function isArriving(part: SessionMessagePart.Type): boolean {
  if (isToolPart(part)) {
    return part.state === "input-streaming" || part.preliminary === true;
  }
  return (
    (part.type === "text" || part.type === "reasoning") &&
    part.state === "streaming"
  );
}

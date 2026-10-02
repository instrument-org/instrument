import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

/** How much of the replied-to message a reply carries, in characters. */
const REPLY_EXCERPT_LENGTH = 200;

/**
 * The start of a message, as a reply quotes it: on one line, and cut at a
 * word with an ellipsis once it runs past the excerpt's length. Enough for
 * the model to tell which of its messages is meant, and for the transcript to
 * draw on one line.
 */
export function replyExcerpt(text: string) {
  const line = text.replaceAll(/\s+/gu, " ").trim();
  if (line.length <= REPLY_EXCERPT_LENGTH) {
    return line;
  }
  const cut = line.slice(0, REPLY_EXCERPT_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > REPLY_EXCERPT_LENGTH / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Tells the model which of its earlier messages the user is answering. */
export function replyModelNote(data: SessionMessageDataPart.ReplyDataPart) {
  return systemNote`
    The user sent this message as a reply to an earlier message of yours, quoted here (only its start, when it is long). "This" and "that" in their message may refer to it.
    > ${data.text}
  `;
}

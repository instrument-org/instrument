import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { systemNote } from "./system-note";

/**
 * The note a question's answer wakes the chat with: what the person picked
 * or wrote on the card for the question it names, or that they skipped it.
 */
export function questionAnswerModelNote(
  data: SessionMessageDataPart.QuestionAnswerDataPart,
): string {
  const { answer, question } = data;
  const said =
    "declined" in answer
      ? `The person skipped your question "${question}". Decide without the answer: take the likelier reading and say which, or say what you cannot do without it.`
      : `The person answered your question "${question}": ${answer.selectedChoice}`;
  return systemNote`${answer.note ? `${said}\nTheir note: ${answer.note}` : said}`;
}

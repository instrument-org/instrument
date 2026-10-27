import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { signInProgressLine } from "./sign-in-progress-model-text";
import { systemNote } from "./system-note";

/**
 * The note a question's answer wakes the chat with: what the person picked
 * or wrote on the card for the question it names, or that they skipped it,
 * and where the chat's open sign-in card stands when it has one.
 */
export function questionAnswerModelNote(
  data: SessionMessageDataPart.QuestionAnswerDataPart,
): string {
  const { answer, question } = data;
  const said =
    "declined" in answer
      ? `The person skipped your question "${question}". Decide without the answer: take the likelier reading and say which, or say what you cannot do without it.`
      : `The person answered your question "${question}": ${answer.selectedChoice}`;
  const lines = [
    said,
    ...(answer.note ? [`Their note: ${answer.note}`] : []),
    ...(data.signIns === undefined
      ? []
      : [
          `Your sign-in card still waits on the user: ${signInProgressLine(data.signIns)} The card shows them the count, so leave it out; you are woken when every app on it is answered.`,
        ]),
  ];
  return systemNote`${lines.join("\n")}`;
}

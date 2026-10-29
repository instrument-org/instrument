import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { answerModelLines } from "./choose-call";
import { signInProgressLine } from "./sign-in-progress-model-text";
import { systemNote } from "./system-note";

/**
 * The note a card's answers wake the chat with: what the person picked or
 * wrote for each question it asked, or that they skipped it, and where the
 * chat's open sign-in card stands when it has one.
 */
export function questionAnswerModelNote(
  data: SessionMessageDataPart.QuestionAnswerDataPart,
): string {
  const lines = [
    ...answerModelLines(
      data.questions.map((question) => ({ question })),
      data.answer,
    ),
    ...(data.signIns === undefined
      ? []
      : [
          `Your sign-in card still waits on the user: ${signInProgressLine(data.signIns)} The card shows them the count, so leave it out; you are woken when every app on it is answered.`,
        ]),
  ];
  return systemNote`${lines.join("\n")}`;
}

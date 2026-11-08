import { z } from "zod";

import {
  type ChooseQuestion,
  ChooseQuestionSchema,
} from "../schemas/choose-question";
import { SessionMessageDataPart } from "../schemas/session/message-data-part";

/** The most questions one `choose` card asks. */
const MAX_CARD_QUESTIONS = 4;

/** What the agent asks a `choose` card with. */
export const ChooseInputSchema = z.object({
  questions: z
    .array(ChooseQuestionSchema)
    .min(1)
    .max(MAX_CARD_QUESTIONS)
    .meta({
      description: `The questions, one to ${MAX_CARD_QUESTIONS}, put on one card and answered together`,
    }),
});

export type { ChooseQuestion };

/** A card earlier builds asked: one question, its choices bare labels. */
const OneQuestionInputSchema = z.object({
  choices: z.array(z.string()),
  question: z.string(),
});

/**
 * A `choose` call's questions, whichever build asked them, or none while its
 * input is still arriving or cannot be read. Takes the stored input as it is,
 * since a call's input is kept as the model wrote it and a record from an
 * earlier build holds the one-question shape.
 */
export function chooseQuestions(input: unknown): ChooseQuestion[] {
  const asked = ChooseInputSchema.safeParse(input);
  if (asked.success) {
    return asked.data.questions;
  }
  const one = OneQuestionInputSchema.safeParse(input);
  return one.success
    ? [
        {
          choices: one.data.choices.map((label) => ({ label })),
          header: "",
          question: one.data.question,
        },
      ]
    : [];
}

const AnsweredOutputSchema = z.union([
  z.object({
    answer: SessionMessageDataPart.StoredQuestionCardAnswerSchema.optional(),
    asked: z.literal(true),
  }),
  SessionMessageDataPart.StoredQuestionCardAnswerSchema,
]);

/**
 * The answer written onto a `choose` call, in the current shape, or nothing
 * while the card is open. Calls from when the turn waited on the card hold
 * the answer as the call's output itself.
 */
export function chooseAnswer(
  output: unknown,
): SessionMessageDataPart.QuestionCardAnswer | undefined {
  const read = AnsweredOutputSchema.safeParse(output);
  if (!read.success) {
    return undefined;
  }
  return "asked" in read.data ? read.data.answer : read.data;
}

/** The line the inbox and the asks list name an open card by. */
export function askLine(questions: { question: string }[]): string {
  const [first, ...rest] = questions;
  if (first === undefined) {
    return "";
  }
  return rest.length === 0
    ? first.question
    : `${first.question} (and ${rest.length} more)`;
}

/**
 * What the agent is told the person answered on its card: one line per
 * question with what they picked or that they skipped it, then their note.
 * `choices`, when known, tells a pick of the agent's own choices from the
 * person's own words.
 */
export function answerModelLines(
  questions: { choices?: { label: string }[]; question: string }[],
  answer: SessionMessageDataPart.QuestionCardAnswer,
): string[] {
  const said = (index: number) => {
    const reply = answer.replies[index];
    if (reply === undefined || "skipped" in reply) {
      return "skipped";
    }
    const labels = questions[index]?.choices?.map((choice) =>
      choice.label.trim(),
    );
    return reply.picked
      .map((picked) =>
        labels === undefined || labels.includes(picked)
          ? picked
          : `${picked} (in their own words)`,
      )
      .join(", ");
  };
  const skipped = (index: number) => {
    const reply = answer.replies[index];
    return reply === undefined || "skipped" in reply;
  };
  if (questions.length === 1) {
    const question = questions[0]?.question ?? "";
    const line = skipped(0)
      ? `The user skipped your question "${question}". Decide without the answer: take the likelier reading and say which, or say what you cannot do without it.`
      : `The user answered your question "${question}": ${said(0)}`;
    return answer.note === undefined
      ? [line]
      : [line, `Their note: ${answer.note}`];
  }
  const lines = [
    "The user answered the questions on your card:",
    ...questions.map(
      ({ question }, index) => `- "${question}": ${said(index)}`,
    ),
    ...(questions.some((_, index) => skipped(index))
      ? [
          "For each one they skipped, decide without its answer: take the likelier reading and say which, or say what you cannot do without it.",
        ]
      : []),
  ];
  return answer.note === undefined
    ? lines
    : [...lines, `Their note: ${answer.note}`];
}

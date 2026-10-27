import ms from "ms";
import { ok } from "neverthrow";
import { z } from "zod";

import { SessionMessageDataPart } from "../schemas/session/message-data-part";
import { defineCapability } from "../lib/capabilities/define";
import { modelTool } from "../lib/capabilities/tool";

// A task runs the chat's agent, questions included, where nobody sees a card.
const ROLE_REFUSAL =
  "You are running in the background, where nobody sees a question: only the chat asks the user. Do what you can, and end your last message with a needs fence naming what you need.";

const NoteSchema = z.string().trim().min(1).optional();

/**
 * Ask the user a closed question.
 *
 * The call puts the question on a card under it and returns at once, so no
 * turn waits on the user: the call itself is the open question
 * (`openQuestionsIn`) until they pick one of the choices, write their own
 * answer, or skip it, and the answer wakes the chat as a
 * `data-questionAnswer`, the way a permission card's does, and is written
 * onto the call, which closes it. Writing in the chat instead closes it
 * unanswered.
 *
 * The answered outputs are what a call returned when the turn waited on the
 * card, which transcripts from then still hold.
 */
export const chooseCapability = defineCapability({
  input: z.object({
    choices: z.array(z.string()).min(2).meta({
      description: "Array of choice options for the user to select from",
    }),
    question: z
      .string()
      .meta({ description: "The question to present to the user" }),
  }),
  name: "asks.choose",
  summary: "Puts a question with choices to the person on a card.",
  surfaces: {
    tool: {
      description:
        "Put a question with multiple choice options to the user on a card in the chat. The card shows them your question and its choices, with a row for an answer in their own words, a note, and Skip, so the card is the whole of the ask and never needs an 'Other' or 'Skip' choice of yours. It returns at once, and their answer reaches you later as a message of its own. If what you do next depends on the answer, end your turn here. Only the chat's card reaches the user: in a task, name the choice in your needs fence instead.",
      execute: () => Promise.resolve(ok({ asked: true as const })),
      readOnly: true,
      timeoutMs: () => ms("10 seconds"),
      toModelOutput: ({ input, output }) => {
        if ("asked" in output) {
          return {
            type: "text",
            value:
              "The user now sees your question and its choices on a card in the chat, and answers there. Their answer reaches you as a message of its own.",
          };
        }
        const answer =
          "declined" in output
            ? "The user skipped the question. Decide without the answer: take the likelier reading and say which, or say what you cannot do without it."
            : input.choices.some(
                  (choice) => choice.trim() === output.selectedChoice,
                )
              ? `User selected: ${output.selectedChoice}`
              : `User answered in their own words: ${output.selectedChoice}`;
        return {
          type: "text",
          value: output.note ? `${answer}\nTheir note: ${output.note}` : answer,
        };
      },
      name: "choose",
      output: z.union([
        z.object({
          /**
           * Written onto the call when the person answers, for the card to draw;
           * the agent hears it from the `data-questionAnswer` the answer wakes
           * the chat with, so the call reads the same to the model either way.
           */
          answer:
            SessionMessageDataPart.QuestionAnswerDataPartSchema.shape.answer.optional(),
          asked: z.literal(true),
        }),
        z.object({ declined: z.literal(true), note: NoteSchema }),
        z.object({
          note: NoteSchema,
          selectedChoice: z.string().trim().min(1),
        }),
      ]),
    },
  },
  where: {
    roles: ["chat"],
    roleRefusal: ROLE_REFUSAL,
  },
});

export const Choose = modelTool(chooseCapability);

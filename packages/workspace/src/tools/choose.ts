import ms from "ms";
import { ok } from "neverthrow";
import { z } from "zod";

import { SessionMessageDataPart } from "../schemas/session/message-data-part";
import {
  answerModelLines,
  chooseAnswer,
  ChooseInputSchema,
  chooseQuestions,
} from "../lib/choose-call";
import { defineCapability } from "../lib/capabilities/define";
import { modelTool } from "../lib/capabilities/tool";

// A task runs the chat's agent, questions included, where nobody sees a card.
const ROLE_REFUSAL =
  "You are running in the background, where nobody sees a question: only the chat asks the user. Do what you can, and end your last message with a needs fence naming what you need.";

const NoteSchema = z.string().trim().min(1).optional();

/**
 * Ask the user closed questions, one to four on one card.
 *
 * The call puts its questions on a card under it and returns at once, so no
 * turn waits on the user: the call itself is the open question
 * (`openQuestionsIn`) until they send their answers or skip the card, and
 * the answers wake the chat together as one `data-questionAnswer`, the way a
 * permission card's does, and are written onto the call, which closes it.
 * Writing in the chat instead closes it unanswered.
 *
 * The answered outputs are what a call returned when the turn waited on the
 * card, which transcripts from then still hold.
 */
const chooseCapability = defineCapability({
  input: ChooseInputSchema,
  name: "asks.choose",
  summary: "Puts questions with choices to the person on a card.",
  surfaces: {
    tool: {
      description:
        "Put one to four questions with multiple choice options to the user on one card in the chat. The card shows them one question at a time, each with your choices, a row for an answer in their own words, a note, and Skip, so the card is the whole of the ask and never needs an 'Other' or 'Skip' choice of yours. They send every answer together. Questions you need answered before going on go on one card, never a card each; ask a later card only for a question that depends on an earlier answer. Your turn ends on this call, and their answers reach you later as a message of their own, so do what does not depend on them first. Only the chat's card reaches the user: in a task, name the choice in your needs fence instead.",
      execute: () => Promise.resolve(ok({ asked: true as const })),
      readOnly: true,
      timeoutMs: () => ms("10 seconds"),
      toModelOutput: ({ input, output }) => {
        if ("asked" in output) {
          return {
            type: "text",
            value:
              "The user now sees your questions and their choices on a card in the chat, and answers there. Their answers reach you together as a message of their own.",
          };
        }
        const answer = chooseAnswer(output);
        return {
          type: "text",
          value:
            answer === undefined
              ? "The user answered the card."
              : answerModelLines(chooseQuestions(input), answer).join("\n"),
        };
      },
      name: "choose",
      output: z.union([
        z.object({
          /**
           * Written onto the call when the person answers, for the card to draw;
           * the agent hears it from the `data-questionAnswer` the answer wakes
           * the chat with, so the call reads the same to the model either way.
           * A call answered by an earlier build holds its answer in that
           * build's shape, which `chooseAnswer` reads.
           */
          answer: SessionMessageDataPart.QuestionCardAnswerSchema.optional(),
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

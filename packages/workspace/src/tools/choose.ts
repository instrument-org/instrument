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
import { recordQuestion } from "../lib/chat/asks";
import { modelTool } from "../lib/capabilities/tool";

// A task runs the chat's agent, questions included, where nobody sees a card.
const ROLE_REFUSAL =
  "You are a task the chat started, running in the background, where nobody sees a card: the chat asks the user its questions itself. Do your assignment, and end your last message with a needs fence naming what you need from the user, if anything.";

const NoteSchema = z.string().trim().min(1).optional();

/**
 * Ask the user closed questions, one to four on one card.
 *
 * The call returns at once, so no turn waits on the user: it raises a
 * `question` ask, by its part's id, held until the turn is over, when the
 * card goes up by the composer with the others the turn asked. They send
 * or skip each card from any device; the computer that asked writes each
 * answer onto its call, and once the turn's cards are all done wakes the
 * chat once, the way a permission card's answer does (`drive-asks.ts`).
 * Writing in the chat instead closes them unanswered.
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
      execute: async ({ chatId, input, messageId, partId, sessionId }) => {
        // Asked during the turn, so held until the session is at rest.
        await recordQuestion(
          { chatId, messageId, partId, sessionId },
          chooseQuestions(input),
          { held: true },
        );
        return ok({ asked: true as const });
      },
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

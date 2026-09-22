import ms from "ms";
import { z } from "zod";

import { executeError } from "../lib/execute-error";
import { BaseInputSchema } from "./base";
import { setupTool } from "./create-tool";

const NoteSchema = z.string().trim().min(1).optional();

/**
 * Ask the user a closed question.
 *
 * Interactive: the call parks the turn until the card answers it. The user
 * picks one of the choices or writes their own answer, which arrives as a
 * `selectedChoice` that is none of them. Either can carry a note. Skipping
 * the question answers the call too, as `declined`, so the agent decides
 * what to do without an answer rather than waiting for one.
 */
export const Choose = setupTool({
  inputSchema: BaseInputSchema.extend({
    choices: z.array(z.string()).min(2).meta({
      description: "Array of choice options for the user to select from",
    }),
    question: z
      .string()
      .meta({ description: "The question to present to the user" }),
  }),
  name: "choose",
  outputSchema: z.union([
    z.object({ declined: z.literal(true), note: NoteSchema }),
    z.object({ note: NoteSchema, selectedChoice: z.string().trim().min(1) }),
  ]),
}).create({
  description:
    "Present a question with multiple choice options to the user and get their selection. The user can also answer in their own words, add a note, or skip the question, so never add an 'Other' or 'Skip' choice yourself.",
  execute: () => {
    return Promise.resolve(executeError("Not implemented"));
  },
  readOnly: true,
  timeoutMs: ms("1 second"),
  toModelOutput: ({ input, output }) => {
    const answer =
      "declined" in output
        ? "The user skipped the question. Decide without the answer: take the likelier reading and say which, or say what you cannot do without it."
        : input.choices.includes(output.selectedChoice)
          ? `User selected: ${output.selectedChoice}`
          : `User answered in their own words: ${output.selectedChoice}`;
    return {
      type: "text",
      value: output.note ? `${answer}\nTheir note: ${output.note}` : answer,
    };
  },
});

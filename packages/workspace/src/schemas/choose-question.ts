import { z } from "zod";

/**
 * One question the agent puts to the person on a `choose` card, as the
 * call's input has it. Apart from the tool so the ask that records the card
 * can name it.
 */

const ChoiceSchema = z.object({
  description: z.string().optional().meta({
    description:
      "A short line under the label saying what picking it means, when the label alone does not",
  }),
  label: z
    .string()
    .meta({ description: "The choice as the card shows it, in a few words" }),
});

/** One question on a `choose` card, with its choices. */
export const ChooseQuestionSchema = z.object({
  choices: z.array(ChoiceSchema).min(2).meta({
    description: "The choices to pick from, two or more",
  }),
  header: z.string().meta({
    description:
      "One to three words naming what the question decides ('Team size'), shown as its tab when the card asks more than one",
  }),
  multiSelect: z.boolean().optional().meta({
    description:
      "True unless the choices exclude each other. Which things to include, install, or do (items, activities, days) take several; one tone, one date, or yes and no take one",
  }),
  question: z
    .string()
    .meta({ description: "The question to present to the user" }),
});

export type ChooseQuestion = z.output<typeof ChooseQuestionSchema>;

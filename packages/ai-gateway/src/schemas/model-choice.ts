import { z } from "zod";

import { AIGatewayModelURI } from "./model-uri";

/**
 * What a person chose for one model: nothing for a setting left on Default.
 * It names the model it was made for, so it says nothing about another.
 */
export const ModelChoiceSchema = z.object({
  /** The level in its provider's own word. */
  effort: z.string().optional(),
  fast: z.boolean().optional(),
  model: AIGatewayModelURI.CanonicalIdSchema,
  /** The kind of connection it is reached through, as two list one model with different levels. */
  provider: z.string(),
});

export type ModelChoice = z.output<typeof ModelChoiceSchema>;

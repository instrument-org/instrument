import { selectDecisionConfigs } from "@instrument-org/ai-gateway";
import { z } from "zod";

import {
  askDecisionModel,
  DecisionQuestionSchema,
  DecisionResponseSchema,
} from "../../lib/decision-model";
import { base } from "../base";

/**
 * Typed questions about a state, answered by the decision model with a
 * probability for every option. The questions are passed through in the
 * System One contract's own shape (`choice`, `score`, `noul`), so a caller
 * builds them from its own data and reads the distributions back.
 */
const ask = base
  .input(
    z.object({
      questions: z.record(z.string(), DecisionQuestionSchema),
      state: z.unknown(),
    }),
  )
  .output(
    DecisionResponseSchema.extend({ ms: z.number(), provider: z.string() }),
  )
  .handler(async ({ context, errors, input, signal }) => {
    let asked: Awaited<ReturnType<typeof askDecisionModel>>;
    try {
      asked = await askDecisionModel({
        body: input,
        configs: context.workspaceConfig.getAIProviderConfigs(),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      throw errors.GATEWAY_FETCH_ERROR({
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (!asked) {
      throw errors.NOT_FOUND({
        message: "Classifying needs an OpenRouter key or an Instrument sign-in",
      });
    }
    return { ...asked.response, ms: asked.ms, provider: asked.provider };
  });

/**
 * Whether any provider the workspace has could reach the decision model: an
 * Instrument sign-in or an OpenRouter key. Read off the configs alone, so a
 * caller can skip asking, and skip saying it is looking, when nothing could
 * answer; a provider that is set up but down still only shows on `ask`.
 */
const available = base
  .output(z.boolean())
  .handler(
    ({ context }) =>
      selectDecisionConfigs(context.workspaceConfig.getAIProviderConfigs())
        .length > 0,
  );

export const decision = { ask, available };

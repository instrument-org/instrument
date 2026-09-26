import { z } from "zod";

import {
  askDecisionModel,
  SystemOneQuestionSchema,
  SystemOneResponseSchema,
} from "../../lib/system-one";
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
      questions: z.record(z.string(), SystemOneQuestionSchema),
      state: z.unknown(),
    }),
  )
  .output(
    SystemOneResponseSchema.extend({ ms: z.number(), provider: z.string() }),
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

export const systemOne = { ask };

import { z } from "zod";

import {
  AIUsagePurposeSchema,
  AIUsageSurfaceSchema,
} from "../../lib/ai-usage/schema";
import { TaskIdSchema } from "../../schemas/task-id";
import {
  askDecisionModel,
  decisionModelAvailable,
  DecisionQuestionSchema,
  DecisionResponseSchema,
} from "../../lib/decision-model";
import { base } from "../base";

/** Why the app is asking, which the record of model requests files the ask under. */
const AIUsageAskSchema = z.object({
  purpose: AIUsagePurposeSchema,
  surface: AIUsageSurfaceSchema.optional(),
  taskId: TaskIdSchema.optional(),
});

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
      usage: AIUsageAskSchema,
    }),
  )
  .output(
    DecisionResponseSchema.extend({ ms: z.number(), provider: z.string() }),
  )
  .handler(async ({ context, errors, input, signal }) => {
    let asked: Awaited<ReturnType<typeof askDecisionModel>>;
    try {
      asked = await askDecisionModel({
        body: { questions: input.questions, state: input.state },
        configs: context.workspaceConfig.getAIProviderConfigs(),
        signal,
        usage: input.usage,
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
        message:
          "The decision model can't be asked: it needs an OpenRouter key or an Instrument sign-in, and is left alone for a minute after asking it fails",
      });
    }
    return { ...asked.response, ms: asked.ms, provider: asked.provider };
  });

/**
 * Whether asking the decision model would send anything: a provider that
 * reaches it is set up (an Instrument sign-in or an OpenRouter key), and
 * asking hasn't just failed. Answered without a request, so a caller can skip
 * asking, and skip saying it is looking, when nothing would answer.
 */
const available = base
  .output(z.boolean())
  .handler(({ context }) =>
    decisionModelAvailable(context.workspaceConfig.getAIProviderConfigs()),
  );

export const decision = { ask, available };

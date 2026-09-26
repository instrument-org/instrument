import {
  askSystemOne,
  selectSystemOneConfigs,
} from "@instrument-org/ai-gateway";
import { z } from "zod";

import { getWorkspaceServerURL } from "../../logic/server/url";
import { base } from "../base";

const AnswerSchema = z.object({
  choice: z.string().optional(),
  confidence: z.number().optional(),
  noul: z.number().optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
  score: z.number().optional(),
  type: z.enum(["choice", "noul", "score"]),
});

const ResponseSchema = z.object({
  answers: z.record(z.string(), AnswerSchema),
  model: z.string(),
  usage: z
    .object({ cost: z.number().optional(), input_tokens: z.number() })
    .partial()
    .optional(),
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
      questions: z.record(
        z.string(),
        z.object({
          criteria: z.unknown().optional(),
          instructions: z.unknown(),
          type: z.enum(["choice", "noul", "score"]),
        }),
      ),
      state: z.unknown(),
    }),
  )
  .output(ResponseSchema.extend({ ms: z.number(), provider: z.string() }))
  .handler(async ({ context, errors, input, signal }) => {
    const configs = selectSystemOneConfigs(
      context.workspaceConfig.getAIProviderConfigs(),
    );
    if (configs.length === 0) {
      throw errors.NOT_FOUND({
        message: "Classifying needs an OpenRouter key or an Instrument sign-in",
      });
    }
    const failures: string[] = [];
    for (const config of configs) {
      const started = performance.now();
      try {
        const body = await askSystemOne({
          body: input,
          config,
          signal,
          workspaceServerURL: getWorkspaceServerURL(),
        });
        return {
          ...ResponseSchema.parse(body),
          ms: Math.round(performance.now() - started),
          provider: config.type,
        };
      } catch (error) {
        if (signal?.aborted) {
          throw error;
        }
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    throw errors.GATEWAY_FETCH_ERROR({ message: failures.join("\n") });
  });

export const systemOne = { ask };

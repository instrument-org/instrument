import {
  type AIGatewayProviderConfig,
  askSystemOne,
  selectSystemOneConfigs,
} from "@instrument-org/ai-gateway";
import { z } from "zod";

import { getWorkspaceServerURL } from "../logic/server/url";

const AnswerSchema = z.object({
  choice: z.string().optional(),
  confidence: z.number().optional(),
  noul: z.number().optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
  score: z.number().optional(),
  type: z.enum(["choice", "noul", "score"]),
});

export const SystemOneResponseSchema = z.object({
  answers: z.record(z.string(), AnswerSchema),
  model: z.string(),
  usage: z
    .object({ cost: z.number().optional(), input_tokens: z.number() })
    .partial()
    .optional(),
});

export const SystemOneQuestionSchema = z.object({
  criteria: z.unknown().optional(),
  instructions: z.unknown(),
  type: z.enum(["choice", "noul", "score"]),
});

/**
 * Typed questions about a state, asked of the decision model through the
 * first provider that answers: an OpenRouter key, then the Instrument
 * sign-in. Nothing when no provider can reach it, so a caller that treats
 * the answer as optional can carry on without; a throw, naming every
 * provider's failure, when each one that could reach it failed.
 */
export async function askDecisionModel({
  body,
  configs,
  signal,
}: {
  body: {
    questions: Record<string, z.output<typeof SystemOneQuestionSchema>>;
    state: unknown;
  };
  configs: AIGatewayProviderConfig.Type[];
  signal?: AbortSignal;
}): Promise<
  | undefined
  | {
      ms: number;
      provider: string;
      response: z.output<typeof SystemOneResponseSchema>;
    }
> {
  const reachable = selectSystemOneConfigs(configs);
  if (reachable.length === 0) {
    return undefined;
  }
  const failures: string[] = [];
  for (const config of reachable) {
    const started = performance.now();
    try {
      const response = await askSystemOne({
        body,
        config,
        signal,
        workspaceServerURL: getWorkspaceServerURL(),
      });
      return {
        ms: Math.round(performance.now() - started),
        provider: config.type,
        response: SystemOneResponseSchema.parse(response),
      };
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`No provider answered:\n${failures.join("\n")}`);
}

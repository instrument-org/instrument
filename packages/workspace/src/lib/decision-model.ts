import {
  type AIGatewayProviderConfig,
  DecisionRequestError,
  requestDecision,
  selectDecisionConfigs,
} from "@instrument-org/ai-gateway";
import ms from "ms";
import { z } from "zod";

import { getWorkspaceServerURL } from "../logic/server/url";
import { type AIUsageCall, recordAIUsage } from "./ai-usage/record";

const AnswerSchema = z.object({
  choice: z.string().optional(),
  confidence: z.number().optional(),
  noul: z.number().optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
  score: z.number().optional(),
  type: z.enum(["choice", "noul", "score"]),
});

export const DecisionResponseSchema = z.object({
  answers: z.record(z.string(), AnswerSchema),
  model: z.string(),
  usage: z
    .object({ cost: z.number().optional(), input_tokens: z.number() })
    .partial()
    .optional(),
});

export const DecisionQuestionSchema = z.object({
  criteria: z.unknown().optional(),
  instructions: z.unknown(),
  type: z.enum(["choice", "noul", "score"]),
});

/**
 * How long the decision model is left alone after every provider that could
 * reach it failed. Each caller treats an answer as optional, so a refusal
 * (a sign-in the API won't serve, a provider that is down) is better met by
 * not asking for a while than by every search and suggestion asking again on
 * each pause in typing.
 */
const UNREACHABLE_FOR = ms("1 minute");
let unreachableUntil = 0;

/**
 * Whether the decision model can be asked: a provider that reaches it is set
 * up, and asking hasn't just failed. What `decision.available` answers, so
 * the app knows before asking rather than finding out by trying.
 */
export function decisionModelAvailable(
  configs: AIGatewayProviderConfig.Type[],
) {
  return (
    selectDecisionConfigs(configs).length > 0 && Date.now() >= unreachableUntil
  );
}

/**
 * Typed questions about a state, asked of the decision model through the
 * first provider that answers: an OpenRouter key, then the Instrument
 * sign-in. Nothing, without sending anything, when no provider can reach it
 * or asking just failed (see {@link decisionModelAvailable}), so a caller
 * that treats the answer as optional can carry on without; a throw, naming
 * every provider's failure, when each one that could reach it failed.
 */
export async function askDecisionModel({
  body,
  configs,
  signal,
  usage,
}: {
  body: {
    questions: Record<string, z.output<typeof DecisionQuestionSchema>>;
    state: unknown;
  };
  configs: AIGatewayProviderConfig.Type[];
  signal?: AbortSignal;
  /** Why the app is asking and for what, which the record of model requests files each attempt under. */
  usage: Omit<AIUsageCall, "connection" | "kind">;
}): Promise<
  | undefined
  | {
      ms: number;
      provider: string;
      response: z.output<typeof DecisionResponseSchema>;
    }
> {
  if (!decisionModelAvailable(configs)) {
    return undefined;
  }
  const reachable = selectDecisionConfigs(configs);
  const failures: string[] = [];
  let requestAtFault = false;
  for (const config of reachable) {
    const started = performance.now();
    const startedAt = Date.now();
    // The decision API is a plain fetch rather than an AI SDK call, so each
    // attempt is recorded here.
    const call: AIUsageCall = {
      ...usage,
      connection: config,
      kind: "decision",
    };
    try {
      const response = DecisionResponseSchema.parse(
        await requestDecision({
          body,
          config,
          signal,
          workspaceServerURL: getWorkspaceServerURL(),
        }),
      );
      unreachableUntil = 0;
      const elapsed = Math.round(performance.now() - started);
      recordAIUsage(call, {
        durationMs: elapsed,
        inputTokens: response.usage?.input_tokens ?? null,
        modelServed: response.model,
        startedAt,
        status: "finished",
      });
      return {
        ms: elapsed,
        provider: config.type,
        response,
      };
    } catch (error) {
      recordAIUsage(call, {
        durationMs: performance.now() - started,
        error: error instanceof Error ? error.message : String(error),
        startedAt,
        status: signal?.aborted ? "stopped" : "failed",
      });
      if (signal?.aborted) {
        throw error;
      }
      // A request the provider rejects as malformed is this caller's to fix,
      // and says nothing about whether the model can answer anyone else.
      if (error instanceof DecisionRequestError && error.status === 400) {
        requestAtFault = true;
      }
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (!requestAtFault) {
    unreachableUntil = Date.now() + UNREACHABLE_FOR;
  }
  throw new Error(`No provider answered:\n${failures.join("\n")}`);
}

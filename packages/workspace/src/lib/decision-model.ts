import {
  type AIGatewayProviderConfig,
  decisionModelFor,
  DecisionRequestError,
  requestDecision,
  selectDecisionConfigs,
} from "@instrument-org/ai-gateway";
import { OUR_MODELS } from "@instrument-org/shared";
import ms from "ms";
import { z } from "zod";

import { getWorkspaceServerURL } from "../logic/server/url";
import { type ActivityCall, recordActivity } from "./activity/record";
import { getWorkspaceConfig, hasWorkspaceConfig } from "./workspace-config";

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
/**
 * How long it is left alone after the Instrument sign-in's plan refused it:
 * no plan or trial, or a usage window spent. Asking sooner gets the same
 * answer, and the person keeps working on their own models meanwhile.
 */
const REFUSED_BY_PLAN_FOR = ms("10 minutes");
let unreachableUntil = 0;

/**
 * Our platform turning the request away for the account's plan rather than
 * failing: an answer about the account, which the chat already explains,
 * and nothing a report or another try would change.
 */
function isRefusedByPlan(error: unknown) {
  return (
    error instanceof DecisionRequestError &&
    (error.status === 402 || error.refusal?.code === "usage-limit-exceeded")
  );
}

/**
 * The providers a decision may be asked through, best first. The Instrument
 * sign-in drops out while its plan says decisions would be refused (the free
 * allowance spent, say), so nothing is sent only to be turned away.
 */
function decisionConfigs(configs: AIGatewayProviderConfig.Type[]) {
  const refusedByPlan =
    hasWorkspaceConfig() &&
    getWorkspaceConfig().isHostedFeatureAvailable?.("decisions") === false;
  return selectDecisionConfigs(configs).filter(
    (config) => !refusedByPlan || config.type !== OUR_MODELS.providerType,
  );
}

/**
 * Whether the decision model can be asked: a provider that reaches it is set
 * up, its plan would serve it, and asking hasn't just failed. What
 * `decision.available` answers, so the app knows before asking rather than
 * finding out by trying.
 */
export function decisionModelAvailable(
  configs: AIGatewayProviderConfig.Type[],
) {
  return decisionConfigs(configs).length > 0 && Date.now() >= unreachableUntil;
}

/**
 * Typed questions about a state, asked of the decision model through the
 * first provider that answers: an OpenRouter key, then the Instrument
 * sign-in. Nothing, without sending anything, when no provider can reach it
 * or asking just failed (see {@link decisionModelAvailable}), and nothing
 * when the account's plan refused every provider that could, so a caller
 * that treats the answer as optional can carry on without; a throw, naming
 * every provider's failure, when each one that could reach it failed.
 */
export async function askDecisionModel({
  body,
  configs,
  signal,
  activity,
}: {
  body: {
    questions: Record<string, z.output<typeof DecisionQuestionSchema>>;
    state: unknown;
  };
  configs: AIGatewayProviderConfig.Type[];
  signal?: AbortSignal;
  /** Why the app is asking and for what, which the record of model requests files each attempt under. */
  activity: Omit<ActivityCall, "connection" | "kind">;
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
  const reachable = decisionConfigs(configs);
  const failures: string[] = [];
  let requestAtFault = false;
  let refusedByPlan = 0;
  for (const config of reachable) {
    const started = performance.now();
    const startedAt = Date.now();
    // The decision API is a plain fetch rather than an AI SDK call, so each
    // attempt is recorded here.
    const call: ActivityCall = {
      ...activity,
      connection: config,
      kind: "decision",
    };
    const modelRequested = decisionModelFor(config.type) ?? null;
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
      recordActivity(call, {
        durationMs: elapsed,
        inputTokens: response.usage?.input_tokens ?? null,
        modelRequested,
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
      recordActivity(call, {
        durationMs: performance.now() - started,
        error: error instanceof Error ? error.message : String(error),
        modelRequested,
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
      if (isRefusedByPlan(error)) {
        refusedByPlan += 1;
      }
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  // Every provider that could answer is one the account's plan refuses: the
  // model is out of reach for now, which callers take as no answer.
  if (refusedByPlan === failures.length) {
    unreachableUntil = Date.now() + REFUSED_BY_PLAN_FOR;
    return undefined;
  }
  if (!requestAtFault) {
    unreachableUntil = Date.now() + UNREACHABLE_FOR;
  }
  throw new Error(`No provider answered:\n${failures.join("\n")}`);
}

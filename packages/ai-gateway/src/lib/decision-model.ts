import {
  OUR_PROVIDER_CONFIG,
  type WorkspaceServerURL,
} from "@instrument-org/shared";

import { type AIGatewayProviderConfig } from "../schemas/provider-config";
import { internalURL } from "./internal-url";
import { internalAPIKey } from "./key-for-provider";

/**
 * The decision model: a classifier that answers typed questions about a state
 * with calibrated probabilities rather than text. It speaks the System One
 * contract (`/v1/systemone`), not chat completions.
 *
 * An OpenRouter key reaches TypeSafe's Jev: the `~…-latest` alias follows new
 * releases, and the pinned id is the fallback for when the alias is refused.
 * A signed-in request asks our API for `instrument/decision` and leaves which
 * model answers to it.
 */
const DECISION_MODELS = new Map<string, readonly string[]>([
  // Providers that can reach the decision model, best first.
  ["openrouter", ["~typesafe/jev-latest", "typesafe/jev-1.13"]],
  [OUR_PROVIDER_CONFIG.type, ["instrument/decision"]],
]);
const DECISION_PROVIDER_TYPES = [...DECISION_MODELS.keys()];

/**
 * A decision request the provider refused, with the HTTP status it answered,
 * so a caller can tell a request at fault (400) from a provider that can't
 * serve it. A network failure throws the fetch's own error instead.
 */
export class DecisionRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DecisionRequestError";
    this.status = status;
  }
}

/**
 * One decision request through the gateway's provider proxy, which swaps
 * the internal key for the provider's own. `body` is passed through as the
 * contract defines it (`state` and `questions`); the model is filled in here,
 * moving to the next of the provider's models only when one is refused as
 * unknown.
 */
export async function requestDecision({
  body,
  config,
  signal,
  workspaceServerURL,
}: {
  body: { questions: Record<string, unknown>; state: unknown };
  config: AIGatewayProviderConfig.Type;
  signal?: AbortSignal;
  workspaceServerURL: WorkspaceServerURL;
}): Promise<unknown> {
  const models = DECISION_MODELS.get(config.type) ?? [];
  let failure = new DecisionRequestError(
    `The decision model is not available via ${config.type}`,
    404,
  );
  for (const model of models) {
    const response = await fetch(
      `${internalURL({ config, workspaceServerURL })}/systemone`,
      {
        body: JSON.stringify({ ...body, model }),
        headers: {
          Authorization: `Bearer ${internalAPIKey()}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal,
      },
    );
    if (response.ok) {
      return response.json();
    }
    const detail = await response.text();
    failure = new DecisionRequestError(
      `Decision request for ${model} via ${config.type} failed (${response.status}): ${detail.slice(0, 300)}`,
      response.status,
    );
    // An unknown model is worth another id; anything else would fail the same.
    if (response.status !== 400 && response.status !== 404) {
      break;
    }
  }
  throw failure;
}

export function selectDecisionConfigs(configs: AIGatewayProviderConfig.Type[]) {
  return configs
    .filter((config) => DECISION_PROVIDER_TYPES.includes(config.type))
    .toSorted(
      (a, b) =>
        DECISION_PROVIDER_TYPES.indexOf(a.type) -
        DECISION_PROVIDER_TYPES.indexOf(b.type),
    );
}

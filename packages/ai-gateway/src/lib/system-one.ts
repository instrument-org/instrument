import {
  OUR_PROVIDER_CONFIG,
  type WorkspaceServerURL,
} from "@instrument-org/shared";

import { type AIGatewayProviderConfig } from "../schemas/provider-config";
import { internalURL } from "./internal-url";
import { internalAPIKey } from "./key-for-provider";

/**
 * The decision model: TypeSafe's Jev, a classifier that answers typed
 * questions about a state with calibrated probabilities rather than text. It
 * speaks its own `/v1/systemone` contract, not chat completions, which
 * OpenRouter serves under the same path.
 *
 * OpenRouter's `~…-latest` alias follows new releases; the pinned id is the
 * fallback for when the alias is refused. Our own API hides every `~…-latest`
 * alias, so a signed-in request goes straight to the pinned id.
 */
const SYSTEM_ONE_MODELS = new Map<string, readonly string[]>([
  // Providers that can reach the decision model, best first.
  ["openrouter", ["~typesafe/jev-latest", "typesafe/jev-1.13"]],
  [OUR_PROVIDER_CONFIG.type, ["typesafe/jev-1.13"]],
]);
const SYSTEM_ONE_PROVIDER_TYPES = [...SYSTEM_ONE_MODELS.keys()];

/**
 * One System One request through the gateway's provider proxy, which swaps
 * the internal key for the provider's own. `body` is passed through as the
 * contract defines it (`state` and `questions`); the model is filled in here,
 * moving to the next of the provider's models only when one is refused as
 * unknown.
 */
export async function askSystemOne({
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
  const models = SYSTEM_ONE_MODELS.get(config.type) ?? [];
  let failure = `System One is not available via ${config.type}`;
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
    failure = `System One request for ${model} via ${config.type} failed (${response.status}): ${detail.slice(0, 300)}`;
    // An unknown model is worth another id; anything else would fail the same.
    if (response.status !== 400 && response.status !== 404) {
      break;
    }
  }
  throw new Error(failure);
}

export function selectSystemOneConfigs(
  configs: AIGatewayProviderConfig.Type[],
) {
  return configs
    .filter((config) => SYSTEM_ONE_PROVIDER_TYPES.includes(config.type))
    .toSorted(
      (a, b) =>
        SYSTEM_ONE_PROVIDER_TYPES.indexOf(a.type) -
        SYSTEM_ONE_PROVIDER_TYPES.indexOf(b.type),
    );
}

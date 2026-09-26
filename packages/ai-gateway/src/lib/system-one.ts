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
 */
export const SYSTEM_ONE_MODEL = "typesafe/jev-1.13";

/** Providers that can reach the decision model, best first. */
const SYSTEM_ONE_PROVIDER_TYPES = ["openrouter", OUR_PROVIDER_CONFIG.type];

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

/**
 * One System One request through the gateway's provider proxy, which swaps
 * the internal key for the provider's own. `body` is passed through as the
 * contract defines it (`state` and `questions`); the model is filled in here.
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
  const response = await fetch(
    `${internalURL({ config, workspaceServerURL })}/systemone`,
    {
      body: JSON.stringify({ ...body, model: SYSTEM_ONE_MODEL }),
      headers: {
        Authorization: `Bearer ${internalAPIKey()}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal,
    },
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `System One request via ${config.type} failed (${response.status}): ${detail.slice(0, 300)}`,
    );
  }
  return response.json();
}

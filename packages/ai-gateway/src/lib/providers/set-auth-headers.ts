import { AI_GATEWAY_API_KEY_NOT_NEEDED } from "@instrument-org/shared";

import { type AIGatewayProviderConfig } from "../../schemas/provider-config";

/**
 * Every header a provider reads a key from. A caller's copy of any of them is
 * the gateway's own key, never the provider's, so it is removed before the
 * provider's is set: a provider that needs no key (a local server, a custom
 * base URL) would otherwise receive the gateway's.
 */
const AUTH_HEADERS = ["authorization", "x-api-key", "x-goog-api-key"];

export function setProviderAuthHeaders(
  headers: Headers,
  config: Pick<AIGatewayProviderConfig.Type, "apiKey" | "type">,
) {
  for (const name of AUTH_HEADERS) {
    headers.delete(name);
  }

  if (config.apiKey === AI_GATEWAY_API_KEY_NOT_NEEDED) {
    return;
  }

  switch (config.type) {
    case "anthropic": {
      headers.set("x-api-key", config.apiKey);
      headers.set("anthropic-version", "2023-06-01");
      break;
    }
    case "google": {
      headers.set("x-goog-api-key", config.apiKey);
      break;
    }
    case "minimax": {
      // A bearer token on the OpenAI-compatible API, Anthropic's header on the
      // Anthropic-compatible one.
      headers.set("Authorization", `Bearer ${config.apiKey}`);
      headers.set("x-api-key", config.apiKey);
      break;
    }
    case "opencode-go":
    case "opencode-zen": {
      // OpenCode reads the key from the header of the API shape it is asked
      // in: a bearer token on the OpenAI endpoints, Anthropic's and Google's
      // own headers on theirs.
      headers.set("Authorization", `Bearer ${config.apiKey}`);
      headers.set("x-api-key", config.apiKey);
      headers.set("x-goog-api-key", config.apiKey);
      break;
    }
    default: {
      headers.set("Authorization", `Bearer ${config.apiKey}`);
      break;
    }
  }
}

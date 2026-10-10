import { OUR_PROVIDER_CONFIG } from "@instrument-org/shared";

import { type AIGatewayProviderConfig } from "../../schemas/provider-config";
import { SlashPrefixedPathSchema } from "../../schemas/slash-prefixed-path";
import { baseURLWithDefault } from "./base-url-with-default";

// If needed, modifies the default base URL to point at the provider's own API
export function apiURL({
  config,
  path,
}: {
  config: Pick<AIGatewayProviderConfig.Type, "baseURL" | "type">;
  path: `/${string}`;
}) {
  const baseURL = baseURLWithDefault(config);
  switch (config.type) {
    case "anthropic": {
      // If missing a /v1, add it (Anthropic SDK expects no /v1 but AI SDK does)
      const finalPath = path.startsWith("/v1") ? path : `/v1${path}`;
      return `${baseURL}${finalPath}`;
    }
    case "chatgpt-account":
    case "openai":
    case "opencode-go":
    case "opencode-zen":
    case "openrouter":
    case OUR_PROVIDER_CONFIG.type: {
      return `${baseURL}/v1${path}`;
    }
    case "google": {
      let adjustedPath = path;
      // Google's SDK adds a /v1beta prefix to the path, Vercel's SDK does not.
      if (path.startsWith("/v1beta")) {
        adjustedPath = SlashPrefixedPathSchema.parse(
          path.replace("/v1beta", ""),
        );
      }
      return `${baseURL}${adjustedPath}`;
    }

    case "minimax": {
      // Models are listed on MiniMax's OpenAI-compatible API, and replies come
      // from the Anthropic-compatible one beside it, which keeps a model's
      // thinking between tool calls.
      if (path.startsWith("/messages")) {
        return `${baseURL.replace(/\/v1$/, "")}/anthropic/v1${path}`;
      }
      return `${baseURL}${path}`;
    }

    case "vercel": {
      // The gateway answers in the stream protocol its path names, so the
      // version follows @ai-sdk/gateway's own default base URL. An older one
      // streams usage and finish reasons in a shape the SDK cannot read.
      return `${baseURL}/v4/ai${path}`;
    }

    default: {
      return `${baseURL}${path}`;
    }
  }
}

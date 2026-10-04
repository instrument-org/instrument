import { type LanguageModelV4 } from "@ai-sdk/provider";
import {
  type AIProviderType,
  type WorkspaceServerURL,
} from "@instrument-org/shared";
import { defaultSettingsMiddleware, wrapLanguageModel } from "ai";
import { Result } from "typescript-result";

import { type AIGatewayProviderConfig } from "../schemas/provider-config";
import { TypedError } from "./errors";
import { fetchJson } from "./fetch-json";
import { internalURL } from "./internal-url";
import { internalAPIKey } from "./key-for-provider";
import { setProviderAuthHeaders } from "./providers/set-auth-headers";

type OpenCodeProviderType = Extract<
  AIProviderType,
  "opencode-go" | "opencode-zen"
>;

/**
 * The API shape OpenCode answers a model in. Its gateway passes a request
 * through to the upstream provider in the shape it arrived in and refuses one
 * whose shape differs from the model's, so each model has to be asked on its
 * own endpoint: `/chat/completions`, `/responses`, `/messages`, or Gemini's
 * `/models/{id}`.
 */
export type OpenCodeEndpoint = "chat" | "google" | "messages" | "responses";

/**
 * Models outside the Claude family that OpenCode serves on `/messages`. Which
 * Qwen and MiniMax releases go this way differs between the two services and
 * follows no naming rule, so they are listed per service from OpenCode's own
 * model docs.
 */
const MESSAGES_MODELS: Record<OpenCodeProviderType, ReadonlySet<string>> = {
  "opencode-go": new Set([
    "minimax-m2.7",
    "minimax-m3",
    "qwen3.7-plus",
    "qwen3.8-flash",
    "qwen3.8-max",
  ]),
  "opencode-zen": new Set([
    "minimax-m2.1-free",
    "minimax-m2.5-free",
    "minimax-m3-free",
    "qwen3.5-plus",
    "qwen3.6-plus",
    "qwen3.6-plus-free",
    "qwen3.8-flash",
  ]),
};

type OpenCodeProviderConfig = AIGatewayProviderConfig.Type & {
  type: OpenCodeProviderType;
};

export function isOpenCodeProviderConfig(
  config: AIGatewayProviderConfig.Type,
): config is OpenCodeProviderConfig {
  return config.type === "opencode-go" || config.type === "opencode-zen";
}

/**
 * Which endpoint one of OpenCode's models answers on. A model this table does
 * not know goes to `/chat/completions`, where OpenCode serves most open
 * models, so a new release of one of those works the day it is listed.
 */
export function openCodeEndpoint(
  type: OpenCodeProviderType,
  modelId: string,
): OpenCodeEndpoint {
  if (modelId.startsWith("claude-") || MESSAGES_MODELS[type].has(modelId)) {
    return "messages";
  }
  if (modelId.startsWith("gemini-")) {
    return "google";
  }
  if (
    modelId.startsWith("gpt-") ||
    modelId.startsWith("muse-spark-") ||
    (modelId.startsWith("grok-") && modelId !== "grok-code")
  ) {
    return "responses";
  }
  return "chat";
}

const AUTHOR_PREFIXES: [prefix: string, author: string][] = [
  ["claude-", "anthropic"],
  ["deepseek-", "deepseek"],
  ["gemini-", "google"],
  ["glm-", "z-ai"],
  ["gpt-", "openai"],
  ["grok-", "x-ai"],
  ["kimi-", "moonshotai"],
  ["minimax-", "minimax"],
  ["mimo-", "xiaomi"],
  ["qwen", "qwen"],
];

/**
 * The vendor behind one of OpenCode's models, read off its id, since the list
 * names OpenCode as the owner of every model it carries.
 */
export function openCodeAuthor(modelId: string): string {
  return (
    AUTHOR_PREFIXES.find(([prefix]) => modelId.startsWith(prefix))?.[1] ??
    "opencode"
  );
}

/**
 * Language models for an OpenCode config, each built with the AI SDK provider
 * for the endpoint its model answers on, all reached through the config's
 * gateway URL.
 */
export async function createOpenCodeLanguageModel(
  config: OpenCodeProviderConfig,
  workspaceServerURL: WorkspaceServerURL,
): Promise<(modelId: string) => LanguageModelV4> {
  const settings = {
    apiKey: internalAPIKey(),
    baseURL: internalURL({ config, workspaceServerURL }),
  };
  const [
    { createAnthropic },
    { createGoogle },
    { createOpenAI },
    { createOpenAICompatible },
  ] = await Promise.all([
    import("@ai-sdk/anthropic"),
    import("@ai-sdk/google"),
    import("@ai-sdk/openai"),
    import("@ai-sdk/openai-compatible"),
  ]);
  const anthropic = createAnthropic(settings);
  const google = createGoogle(settings);
  const openai = createOpenAI(settings);
  const chat = createOpenAICompatible({ ...settings, name: config.type });
  // OpenCode keeps nothing between requests, so the SDK must not replay an
  // earlier reply as a reference to its stored item id.
  const middleware = defaultSettingsMiddleware({
    settings: { providerOptions: { openai: { store: false } } },
  });

  return (modelId) => {
    switch (openCodeEndpoint(config.type, modelId)) {
      case "chat": {
        return chat(modelId);
      }
      case "google": {
        return google(modelId);
      }
      case "messages": {
        return anthropic(modelId);
      }
      case "responses": {
        return wrapLanguageModel({
          middleware,
          model: openai.responses(modelId),
        });
      }
    }
  };
}

/**
 * Checks a key against OpenCode's Go usage endpoint, the one route that
 * answers a key without running a model: both model lists are public, so
 * reading one proves nothing. Zen and Go share one key per workspace, and the
 * route refuses an unknown key (401) differently from a key with no Go
 * subscription (403).
 *
 * Only those two answers fail a key. OpenCode serves its newer keys from a
 * second backend whose answers here are not published, so any other status
 * passes rather than turning a working key away; a bad key that slips through
 * fails on its first request instead.
 */
export function verifyOpenCodeApiKey(
  config: Pick<AIGatewayProviderConfig.Type, "apiKey"> & {
    type: OpenCodeProviderType;
  },
  baseURL: string,
) {
  const headers = new Headers();
  setProviderAuthHeaders(headers, config);
  const url =
    config.type === "opencode-go"
      ? `${baseURL}/v1/usage`
      : `${baseURL}/go/v1/usage`;
  return Result.fromAsync(async () => {
    const result = await fetchJson({ cache: false, headers, url });
    if (result.ok) {
      return Result.ok(true);
    }
    const status =
      result.error instanceof TypedError.Fetch
        ? result.error.status
        : undefined;
    if (status === 401 || status === undefined) {
      return Result.error(
        new TypedError.VerificationFailed("Unable to verify OpenCode API key", {
          cause: result.error,
        }),
      );
    }
    if (status === 403 && config.type === "opencode-go") {
      return Result.error(
        new TypedError.VerificationFailed(
          "This OpenCode key has no Go subscription",
          { cause: result.error },
        ),
      );
    }
    return Result.ok(true);
  });
}

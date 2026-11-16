// Static import because @ai-sdk/gateway is already statically imported by the ai package,
// so dynamic import won't code-split it into a separate chunk
import { createGateway } from "@ai-sdk/gateway";
import {
  APP_NAME,
  APP_URL,
  type WorkspaceServerURL,
} from "@instrument-org/shared";

import { type AIGatewayProviderConfig } from "../schemas/provider-config";
import { getPackageForProviderType } from "./bundled-providers";
import { isWorkersAiProviderConfig } from "./fetch-models/parse-workers-ai-base-url";
import { internalURL } from "./internal-url";
import { internalAPIKey } from "./key-for-provider";
import {
  createOpenCodeLanguageModel,
  isOpenCodeProviderConfig,
} from "./opencode";
import { openRouterCacheShape } from "./openrouter-cache-shape";
import { createOpenRouterLanguageModel } from "./openrouter-language-model";
import { repairWorkersAiStream } from "./workers-ai-stream-repair";

type Fetch = typeof globalThis.fetch;

export async function aiSDKForProviderConfig(
  config: AIGatewayProviderConfig.Type,
  workspaceServerURL: WorkspaceServerURL,
  {
    fetch,
    sourceModelIdOf,
  }: {
    /**
     * The fetch every request to the provider goes through, which a caller
     * wraps to watch the response arrive. The provider's own fixes wrap it.
     */
    fetch?: Fetch;
    /** The model an alias resolves to right now, by its provider id. */
    sourceModelIdOf?: (modelId: string) => string | undefined;
  } = {},
) {
  const baseURL = internalURL({ config, workspaceServerURL });
  const apiKey = internalAPIKey();
  const packageName = getPackageForProviderType(config.type);

  if (config.type === "claude-account") {
    if (!config.executablePath) {
      throw new Error("The Claude account has no Claude Code to run.");
    }
    const { createClaudeAccountLanguageModel } =
      await import("./providers/claude-account/language-model");
    return createClaudeAccountLanguageModel({
      configDir: config.configDir,
      executablePath: config.executablePath,
      providerConfigId: config.id,
    });
  }

  if (isOpenCodeProviderConfig(config)) {
    return createOpenCodeLanguageModel(config, workspaceServerURL, fetch);
  }

  switch (packageName) {
    case "@ai-sdk/anthropic": {
      return createAnthropicSDK(config, workspaceServerURL, fetch);
    }
    case "@ai-sdk/cerebras": {
      const { createCerebras } = await import("@ai-sdk/cerebras");
      return createCerebras({ apiKey, baseURL, fetch });
    }
    case "@ai-sdk/deepinfra": {
      const { createDeepInfra } = await import("@ai-sdk/deepinfra");
      return createDeepInfra({ apiKey, baseURL, fetch });
    }
    case "@ai-sdk/deepseek": {
      const { createDeepSeek } = await import("@ai-sdk/deepseek");
      return createDeepSeek({ apiKey, baseURL, fetch });
    }
    case "@ai-sdk/fireworks": {
      return createFireworksSDK(config, workspaceServerURL, fetch);
    }
    case "@ai-sdk/gateway": {
      return createVercelSDK(config, workspaceServerURL, fetch);
    }
    case "@ai-sdk/google": {
      return createGoogleSDK(config, workspaceServerURL, fetch);
    }
    case "@ai-sdk/groq": {
      const { createGroq } = await import("@ai-sdk/groq");
      return createGroq({ apiKey, baseURL, fetch });
    }
    case "@ai-sdk/minimax": {
      const { createMiniMax } = await import("@ai-sdk/minimax");
      return createMiniMax({ apiKey, baseURL, fetch });
    }
    case "@ai-sdk/mistral": {
      const { createMistral } = await import("@ai-sdk/mistral");
      return createMistral({ apiKey, baseURL, fetch });
    }
    case "@ai-sdk/openai": {
      return createOpenAISDK(config, workspaceServerURL, fetch);
    }
    case "@ai-sdk/openai-compatible": {
      const { createOpenAICompatible } =
        await import("@ai-sdk/openai-compatible");
      return createOpenAICompatible({
        apiKey,
        baseURL,
        // Workers AI is reached as an OpenAI-compatible provider, because that
        // is the only type whose model listing knows its models/search API.
        // Its stream needs the same repair here as on the `openai` path.
        fetch: isWorkersAiProviderConfig(config)
          ? repairWorkersAiStream(fetch)
          : fetch,
        name: config.type,
      });
    }
    case "@ai-sdk/togetherai": {
      const { createTogetherAI } = await import("@ai-sdk/togetherai");
      return createTogetherAI({ apiKey, baseURL, fetch });
    }
    case "@ai-sdk/xai": {
      return createXAISDK(config, workspaceServerURL, fetch);
    }
    case "@ai-sdk/zai": {
      const { createZai } = await import("@ai-sdk/zai");
      return createZai({ apiKey, baseURL, fetch });
    }
    case "@openrouter/ai-sdk-provider": {
      return createOpenRouterLanguageModel({
        chat: await createOpenRouterSDK(config, workspaceServerURL, fetch),
        fetch,
        config,
        sourceModelIdOf,
        workspaceServerURL,
      });
    }
    case "ai-sdk-ollama": {
      const { createOllama } = await import("ai-sdk-ollama");
      return createOllama({
        baseURL,
        fetch,
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    }
  }
}

export async function createAnthropicSDK(
  config: AIGatewayProviderConfig.Type,
  workspaceServerURL: WorkspaceServerURL,
  fetch?: Fetch,
) {
  const baseURL = internalURL({ config, workspaceServerURL });
  const apiKey = internalAPIKey();
  const { createAnthropic } = await import("@ai-sdk/anthropic");
  return createAnthropic({ apiKey, baseURL, fetch });
}

export async function createDeepInfraSDK(
  config: AIGatewayProviderConfig.Type,
  workspaceServerURL: WorkspaceServerURL,
  fetch?: Fetch,
) {
  const baseURL = internalURL({ config, workspaceServerURL });
  const apiKey = internalAPIKey();
  const { createDeepInfra } = await import("@ai-sdk/deepinfra");
  return createDeepInfra({ apiKey, baseURL, fetch });
}

export async function createFireworksSDK(
  config: AIGatewayProviderConfig.Type,
  workspaceServerURL: WorkspaceServerURL,
  fetch?: Fetch,
) {
  const baseURL = internalURL({ config, workspaceServerURL });
  const apiKey = internalAPIKey();
  const { createFireworks } = await import("@ai-sdk/fireworks");
  return createFireworks({ apiKey, baseURL, fetch });
}

export async function createGoogleSDK(
  config: AIGatewayProviderConfig.Type,
  workspaceServerURL: WorkspaceServerURL,
  fetch?: Fetch,
) {
  const baseURL = internalURL({ config, workspaceServerURL });
  const apiKey = internalAPIKey();
  const { createGoogle } = await import("@ai-sdk/google");
  return createGoogle({ apiKey, baseURL, fetch });
}

export async function createOpenAISDK(
  config: AIGatewayProviderConfig.Type,
  workspaceServerURL: WorkspaceServerURL,
  fetch?: Fetch,
) {
  const baseURL = internalURL({ config, workspaceServerURL });
  const apiKey = internalAPIKey();
  const { createOpenAI } = await import("@ai-sdk/openai");
  return createOpenAI({
    apiKey,
    baseURL,
    // Workers AI streams what the SDK refuses; see the repair for what.
    fetch: isWorkersAiProviderConfig(config)
      ? repairWorkersAiStream(fetch)
      : fetch,
  });
}

export async function createOpenRouterSDK(
  config: AIGatewayProviderConfig.Type,
  workspaceServerURL: WorkspaceServerURL,
  fetch?: Fetch,
) {
  const baseURL = internalURL({ config, workspaceServerURL });
  const apiKey = internalAPIKey();
  const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");
  const extraConfig =
    config.type === "openrouter"
      ? {
          // Same `user` every request for this config so OpenRouter-side caching stays consistent.
          extraBody: { user: config.cacheIdentifier },
        }
      : {};
  return createOpenRouter({
    apiKey,
    appName: APP_NAME,
    appUrl: APP_URL,
    baseURL,
    fetch: openRouterCacheShape(fetch),
    ...extraConfig,
  });
}

export async function createTogetherAISDK(
  config: AIGatewayProviderConfig.Type,
  workspaceServerURL: WorkspaceServerURL,
  fetch?: Fetch,
) {
  const baseURL = internalURL({ config, workspaceServerURL });
  const apiKey = internalAPIKey();
  const { createTogetherAI } = await import("@ai-sdk/togetherai");
  return createTogetherAI({ apiKey, baseURL, fetch });
}

export function createVercelSDK(
  config: AIGatewayProviderConfig.Type,
  workspaceServerURL: WorkspaceServerURL,
  fetch?: Fetch,
) {
  const baseURL = internalURL({ config, workspaceServerURL });
  const apiKey = internalAPIKey();
  return createGateway({
    apiKey,
    baseURL,
    fetch,
    headers: {
      "http-referer": APP_URL,
      "x-title": APP_NAME,
    },
  });
}

export async function createXAISDK(
  config: AIGatewayProviderConfig.Type,
  workspaceServerURL: WorkspaceServerURL,
  fetch?: Fetch,
) {
  const baseURL = internalURL({ config, workspaceServerURL });
  const apiKey = internalAPIKey();
  const { createXai } = await import("@ai-sdk/xai");
  return createXai({ apiKey, baseURL, fetch });
}

import { type LanguageModelV3 } from "@ai-sdk/provider";
import { OUR_MODELS, type WorkspaceServerURL } from "@instrument-org/shared";
import { tool, type ToolSet } from "ai";
import { z } from "zod";

import { type AIGatewayModel } from "../schemas/model";
import { type AIGatewayProviderConfig } from "../schemas/provider-config";
import {
  createAnthropicSDK,
  createGoogleSDK,
  createOpenAISDK,
  createOpenRouterSDK,
  createVercelSDK,
  createXAISDK,
} from "./ai-sdk-for-provider-config";
import { TEST_MODEL_OVERRIDE_KEY } from "./fetch-ai-sdk-model";

export interface AISDKWebToolsResult {
  model?: LanguageModelV3;
  tools: ToolSet;
}

export const TEST_WEB_TOOLS_OVERRIDE_KEY = "__testWebToolsOverride";

const openRouterWebFetch = tool({
  args: {},
  id: "openrouter.web_fetch",
  inputSchema: z.object({ url: z.string() }),
  type: "provider",
});

export async function getAISDKWebTools({
  config,
  model,
  workspaceServerURL,
}: {
  config: AIGatewayProviderConfig.Type;
  model: AIGatewayModel.Type;
  workspaceServerURL: WorkspaceServerURL;
}): Promise<AISDKWebToolsResult> {
  const testOverride = (
    config as {
      [TEST_WEB_TOOLS_OVERRIDE_KEY]?: AISDKWebToolsResult;
    }
  )[TEST_WEB_TOOLS_OVERRIDE_KEY];
  if (testOverride) {
    return testOverride;
  }
  if (TEST_MODEL_OVERRIDE_KEY in config) {
    return { tools: {} };
  }

  switch (config.type) {
    case "anthropic": {
      const sdk = await createAnthropicSDK(config, workspaceServerURL);
      return {
        tools: {
          web_fetch: sdk.tools.webFetch_20250910({}),
          web_search: sdk.tools.webSearch_20250305({}),
        },
      };
    }
    case "google": {
      // Gemini 2 can use hosted tools or function tools, but only Gemini 3 can
      // combine them in the same request.
      if (!model.providerId.includes("gemini-3")) {
        return { tools: {} };
      }
      const sdk = await createGoogleSDK(config, workspaceServerURL);
      return {
        tools: {
          web_fetch: sdk.tools.urlContext({}),
          web_search: sdk.tools.googleSearch({}),
        },
      };
    }
    case "openai": {
      const sdk = await createOpenAISDK(config, workspaceServerURL);
      return { tools: { web_search: sdk.tools.webSearch() } };
    }
    case "openrouter":
    case OUR_MODELS.providerType: {
      const sdk = await createOpenRouterSDK(config, workspaceServerURL);
      return {
        tools: {
          web_fetch: openRouterWebFetch,
          web_search: sdk.tools.webSearch({}),
        },
      };
    }
    case "vercel": {
      const sdk = createVercelSDK(config, workspaceServerURL);
      return { tools: { web_search: sdk.tools.perplexitySearch() } };
    }
    case "x-ai": {
      const sdk = await createXAISDK(config, workspaceServerURL);
      return {
        model: sdk.responses(model.providerId),
        tools: { web_search: sdk.tools.webSearch() },
      };
    }
    default: {
      return { tools: {} };
    }
  }
}

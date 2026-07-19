import {
  AIProviderConfigIdSchema,
  type AIProviderType,
  OUR_MODELS,
  type WorkspaceServerURL,
} from "@instrument-org/shared";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { describe, expect, it, vi } from "vitest";

import { AIGatewayModel } from "../schemas/model";
import { AIGatewayModelURI } from "../schemas/model-uri";
import { AIGatewayProviderConfig } from "../schemas/provider-config";
import { getAISDKWebTools } from "./get-ai-sdk-web-tools";

const workspaceServerURL = "http://localhost" as WorkspaceServerURL;

function createConfig(type: AIProviderType) {
  return AIGatewayProviderConfig.Schema.parse({
    apiKey: "test-key",
    cacheIdentifier: "test-cache",
    id: AIProviderConfigIdSchema.parse(`${type}-config`),
    type,
  });
}

function createModel(type: AIProviderType, id = "test-model") {
  const config = createConfig(type);
  const canonicalId = AIGatewayModel.CanonicalIdSchema.parse(id);
  const providerId = AIGatewayModel.ProviderIdSchema.parse(id);
  const params = { provider: type, providerConfigId: config.id };
  return AIGatewayModel.Schema.parse({
    author: type,
    canonicalId,
    features: ["inputText", "outputText", "tools"],
    name: "Test model",
    params,
    providerId,
    providerName: type,
    tags: [],
    uri: AIGatewayModelURI.fromModel({ author: type, canonicalId, params }),
  });
}

describe("getAISDKWebTools", () => {
  it.each([
    {
      fetchId: "anthropic.web_fetch_20250910",
      searchId: "anthropic.web_search_20250305",
      type: "anthropic",
    },
    {
      fetchId: "google.url_context",
      searchId: "google.google_search",
      type: "google",
    },
    { searchId: "openai.web_search", type: "openai" },
    {
      fetchId: "openrouter.web_fetch",
      searchId: "openrouter.web_search",
      type: "openrouter",
    },
    {
      fetchId: "openrouter.web_fetch",
      searchId: "openrouter.web_search",
      type: OUR_MODELS.providerType,
    },
    { searchId: "gateway.perplexity_search", type: "vercel" },
    { searchId: "xai.web_search", type: "x-ai" },
  ] satisfies {
    fetchId?: string;
    searchId: string;
    type: AIProviderType;
  }[])(
    "returns provider-executed web tools for $type",
    async ({ fetchId, searchId, type }) => {
      const result = await getAISDKWebTools({
        config: createConfig(type),
        model: createModel(
          type,
          type === "google" ? "gemini-3-flash-preview" : "test-model",
        ),
        workspaceServerURL,
      });

      expect(result.tools.web_search).toMatchObject({
        id: searchId,
        type: "provider",
      });
      if (fetchId) {
        expect(result.tools.web_fetch).toMatchObject({
          id: fetchId,
          type: "provider",
        });
      } else {
        expect(result.tools.web_fetch).toBeUndefined();
      }
      if (type === "x-ai") {
        expect(result.model?.provider).toBe("xai.responses");
      } else {
        expect(result.model).toBeUndefined();
      }
    },
  );

  it("returns no tools for providers without hosted web tools", async () => {
    const result = await getAISDKWebTools({
      config: createConfig("deepseek"),
      model: createModel("deepseek"),
      workspaceServerURL,
    });

    expect(result).toEqual({ tools: {} });
  });

  it("keeps delegated search for Google models that cannot mix tools", async () => {
    const result = await getAISDKWebTools({
      config: createConfig("google"),
      model: createModel("google", "gemini-2.5-flash"),
      workspaceServerURL,
    });

    expect(result).toEqual({ tools: {} });
  });

  it("serializes OpenRouter web tools using the server-tool API", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                index: 0,
                message: { content: "done", role: "assistant" },
              },
            ],
            created: 0,
            id: "test-generation",
            model: "openai/gpt-5",
            object: "chat.completion",
            usage: {
              completion_tokens: 1,
              prompt_tokens: 1,
              total_tokens: 2,
            },
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      ),
    );
    const sdk = createOpenRouter({ apiKey: "test-key", fetch: fetchMock });
    const webTools = await getAISDKWebTools({
      config: createConfig("openrouter"),
      model: createModel("openrouter"),
      workspaceServerURL,
    });

    await generateText({
      model: sdk("openai/gpt-5"),
      prompt: "Research this",
      tools: webTools.tools,
    });

    const requestBody = fetchMock.mock.calls[0]?.[1]?.body;
    if (typeof requestBody !== "string") {
      throw new TypeError("Expected a serialized request body");
    }
    const parsedRequestBody: unknown = JSON.parse(requestBody);
    expect(parsedRequestBody).toMatchObject({
      tools: [
        { type: "openrouter:web_fetch" },
        { type: "openrouter:web_search" },
      ],
    });
  });
});

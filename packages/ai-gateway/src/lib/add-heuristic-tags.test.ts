import {
  AIProviderConfigIdSchema,
  OUR_MODELS,
  OUR_PROVIDER_CONFIG,
} from "@instrument-org/shared";
import { describe, expect, it } from "vitest";

import { AIGatewayModel } from "../schemas/model";
import { AIGatewayModelURI } from "../schemas/model-uri";
import { type AIGatewayProviderConfig } from "../schemas/provider-config";
import { addHeuristicTags } from "./add-heuristic-tags";

const mockConfig: AIGatewayProviderConfig.Type = {
  apiKey: "NOT_NEEDED",
  cacheIdentifier: OUR_MODELS.cacheIdentifier,
  id: OUR_PROVIDER_CONFIG.id,
  type: "openrouter",
};

function createMockModel(
  providerId: string,
  existingTags: AIGatewayModel.ModelTag[] = [],
): AIGatewayModel.Type {
  const [author = "test-author", rawCanonicalId = providerId] =
    providerId.split("/");
  const canonicalId = AIGatewayModel.CanonicalIdSchema.parse(rawCanonicalId);
  const params = {
    provider: "openrouter" as const,
    providerConfigId: mockConfig.id,
  };
  return {
    author,
    canonicalId,
    features: [],
    name: canonicalId,
    params,
    providerId: AIGatewayModel.ProviderIdSchema.parse(providerId),
    providerName: "Test Provider",
    tags: existingTags,
    uri: AIGatewayModelURI.fromModel({ author, canonicalId, params }),
  };
}

describe("addHeuristicTags", () => {
  const testCases: {
    expected: AIGatewayModel.ModelTag[];
    modelId: string;
  }[] = [
    { expected: ["legacy"], modelId: "gpt-4.1" },
    { expected: ["legacy"], modelId: "gpt-4-turbo" },
    { expected: ["coding", "legacy"], modelId: "gpt-5" },
    { expected: ["coding", "legacy"], modelId: "gpt-5.1" },
    { expected: ["coding", "legacy"], modelId: "gpt-5.1-codex" },
    { expected: ["coding", "legacy"], modelId: "gpt-5.1-codex-max" },
    { expected: ["coding", "legacy"], modelId: "gpt-5.2" },
    { expected: ["coding", "legacy"], modelId: "gpt-5.3-codex" },
    { expected: ["coding"], modelId: "gpt-5.4" },
    { expected: ["coding"], modelId: "gpt-5.4-mini" },
    { expected: ["coding"], modelId: "gpt-5.4-nano" },
    // Pro and Fast keep their tags here; `demoteVariantsOfListedModels` is
    // what takes them away, and it needs the rest of the provider's list.
    { expected: ["coding"], modelId: "gpt-5.4-pro" },
    { expected: [], modelId: "gpt-5.4-image-2" },
    { expected: ["coding", "recommended"], modelId: "gpt-5.5" },
    { expected: ["coding", "recommended"], modelId: "gpt-5.5-pro" },
    { expected: ["coding", "recommended"], modelId: "gpt-5.6-luna" },
    { expected: ["coding", "recommended"], modelId: "gpt-5.6-terra" },
    { expected: ["coding", "recommended"], modelId: "gpt-5.6-sol" },
    { expected: ["coding", "recommended"], modelId: "gpt-5.6-sol-pro" },
    { expected: ["coding", "recommended"], modelId: "gpt-5.6-luna-pro" },
    { expected: ["coding", "recommended"], modelId: "gpt-6" },
    { expected: ["coding", "recommended"], modelId: "gpt-10" },
    { expected: [], modelId: "gpt-oss-120b" },
    { expected: ["legacy"], modelId: "claude-3-opus" },
    { expected: ["legacy"], modelId: "claude-3-sonnet" },
    { expected: ["legacy"], modelId: "claude-3.5-haiku" },
    { expected: ["coding", "legacy"], modelId: "claude-sonnet-4" },
    { expected: ["coding", "legacy"], modelId: "claude-sonnet-4.5" },
    { expected: ["coding", "legacy"], modelId: "claude-sonnet-4.6" },
    {
      expected: ["coding", "recommended", "default"],
      modelId: "claude-sonnet-5",
    },
    { expected: ["coding", "recommended"], modelId: "claude-sonnet-5.5" },
    { expected: ["coding", "recommended"], modelId: "claude-sonnet-6" },
    { expected: ["coding", "legacy"], modelId: "claude-haiku-4" },
    { expected: ["coding", "legacy"], modelId: "claude-haiku-4.2" },
    { expected: ["coding", "recommended"], modelId: "claude-haiku-4.5" },
    { expected: ["coding", "recommended"], modelId: "claude-haiku-5" },
    { expected: ["coding", "legacy"], modelId: "claude-opus-4.6" },
    { expected: ["coding", "legacy"], modelId: "claude-opus-4.7" },
    { expected: ["coding", "legacy"], modelId: "claude-opus-4.8" },
    { expected: ["coding", "recommended"], modelId: "claude-opus-5" },
    { expected: ["coding", "recommended"], modelId: "claude-opus-5-fast" },
    { expected: ["coding", "recommended"], modelId: "claude-fable-5" },
    { expected: ["coding", "recommended"], modelId: "claude-fable-6" },
    { expected: ["legacy"], modelId: "gemini-2-flash" },
    { expected: ["legacy"], modelId: "gemini-2.5-pro" },
    { expected: ["legacy"], modelId: "gemini-2.5-flash" },
    { expected: ["coding"], modelId: "gemini-3" },
    { expected: ["coding"], modelId: "gemini-3-pro" },
    { expected: ["coding"], modelId: "gemini-3-flash-preview" },
    { expected: [], modelId: "gemini-3-pro-image" },
    { expected: ["coding", "recommended"], modelId: "gemini-3.1-pro-preview" },
    { expected: ["coding", "recommended"], modelId: "gemini-3.1-flash-lite" },
    { expected: [], modelId: "gemini-3.1-flash-live-preview" },
    { expected: ["coding", "recommended"], modelId: "gemini-3.5-flash" },
    { expected: ["coding", "recommended"], modelId: "gemini-3.7-flash" },
    { expected: ["coding", "recommended"], modelId: "gemini-4" },
    { expected: [], modelId: "grok-3" },
    { expected: [], modelId: "grok-4" },
    { expected: [], modelId: "grok-4.3" },
    { expected: [], modelId: "grok-4.20" },
    { expected: ["coding", "recommended"], modelId: "grok-4.5" },
    { expected: ["coding", "recommended"], modelId: "grok-4.6" },
    { expected: ["coding", "recommended"], modelId: "grok-5" },
    { expected: ["coding", "recommended"], modelId: "grok-build-0.1" },
    { expected: [], modelId: "grok-imagine-image-2.0" },
    { expected: [], modelId: "glm-4.7" },
    { expected: [], modelId: "glm-4.1v-9b-thinking" },
    { expected: [], modelId: "glm-5" },
    { expected: [], modelId: "glm-5.1" },
    { expected: [], modelId: "glm-5v-turbo" },
    { expected: ["coding", "recommended"], modelId: "glm-5.2" },
    { expected: ["coding", "recommended"], modelId: "glm-5.3" },
    { expected: ["coding", "recommended"], modelId: "glm-5.3-flash" },
    { expected: [], modelId: "kimi-k2" },
    { expected: [], modelId: "kimi-k2.5" },
    { expected: ["coding", "recommended"], modelId: "kimi-k2.6" },
    { expected: ["coding", "recommended"], modelId: "kimi-k2.7-code" },
    { expected: ["coding", "recommended"], modelId: "kimi-k3" },
    { expected: [], modelId: "minimax-m2" },
    { expected: [], modelId: "minimax-m2.7" },
    { expected: ["coding", "recommended"], modelId: "minimax-m3" },
    { expected: [], modelId: "qwen3-coder" },
    { expected: [], modelId: "qwen3-coder-next" },
    { expected: [], modelId: "qwen-3-coder-480b" },
    { expected: [], modelId: "qwen3.6-plus" },
    { expected: ["coding", "recommended"], modelId: "qwen3.7-max" },
    { expected: ["coding", "recommended"], modelId: "qwen3.8-max" },
    { expected: ["coding", "recommended"], modelId: "qwen3.8-2.4t-a95b" },
    { expected: [], modelId: "deepseek-v3.2" },
    { expected: ["coding", "recommended"], modelId: "deepseek-v4-pro" },
    {
      expected: ["coding", "recommended"],
      modelId: "deepseek-v4-flash-0731",
    },
    { expected: [], modelId: "deepseek-v4-flash-vision-exp" },
    { expected: [], modelId: "devstral-2512" },
  ].map(({ expected, modelId }) => ({
    expected: expected.map((tag) => AIGatewayModel.ModelTagSchema.parse(tag)),
    modelId,
  }));

  it.each(testCases)(
    "should return $expected for $modelId",
    ({ expected, modelId }) => {
      const model = createMockModel(modelId);
      const result = addHeuristicTags(model, mockConfig);
      expect(result.tags).toEqual(expected);
    },
  );

  it("should add default tag for openai provider defaults", () => {
    const openaiConfig: AIGatewayProviderConfig.Type = {
      apiKey: "NOT_NEEDED",
      cacheIdentifier: "openai",
      id: AIProviderConfigIdSchema.parse("openai"),
      type: "openai",
    };
    const model = createMockModel("openai/gpt-5.6-terra");
    const result = addHeuristicTags(model, openaiConfig);
    expect(result.tags).toContain("default");
  });

  it("should add default tag for anthropic provider defaults", () => {
    const anthropicConfig: AIGatewayProviderConfig.Type = {
      apiKey: "NOT_NEEDED",
      cacheIdentifier: "anthropic",
      id: AIProviderConfigIdSchema.parse("anthropic"),
      type: "anthropic",
    };
    const model = createMockModel("anthropic/claude-sonnet-5");
    const result = addHeuristicTags(model, anthropicConfig);
    expect(result.tags).toContain("default");
  });

  it("should add default tag for z-ai provider defaults", () => {
    const zAiConfig: AIGatewayProviderConfig.Type = {
      apiKey: "NOT_NEEDED",
      cacheIdentifier: "z-ai",
      id: AIProviderConfigIdSchema.parse("z-ai"),
      type: "z-ai",
    };
    const model = createMockModel("z-ai/glm-5.3");
    const result = addHeuristicTags(model, zAiConfig);
    expect(result.tags).toContain("default");
  });

  it("should add default tag for google provider defaults", () => {
    const googleConfig: AIGatewayProviderConfig.Type = {
      apiKey: "NOT_NEEDED",
      cacheIdentifier: "google",
      id: AIProviderConfigIdSchema.parse("google"),
      type: "google",
    };
    const model = createMockModel("google/gemini-3.7-flash");
    const result = addHeuristicTags(model, googleConfig);
    expect(result.tags).toContain("default");
  });

  it.each([
    {
      config: {
        apiKey: "NOT_NEEDED",
        cacheIdentifier: "openai",
        id: AIProviderConfigIdSchema.parse("openai"),
        type: "openai",
      } satisfies AIGatewayProviderConfig.Type,
      providerId: "openai/gpt-5.3-codex",
    },
    {
      config: {
        apiKey: "NOT_NEEDED",
        cacheIdentifier: "openai-compatible",
        id: AIProviderConfigIdSchema.parse("openai-compatible"),
        type: "openai-compatible",
      } satisfies AIGatewayProviderConfig.Type,
      providerId: "openai-compatible/gpt-5-codex",
    },
  ])(
    "should not recommend or default codex models for $config.type",
    ({ config, providerId }) => {
      const model = createMockModel(providerId);
      const result = addHeuristicTags(model, config);
      expect(result.tags).not.toContain("recommended");
      expect(result.tags).not.toContain("default");
      expect(result.tags).toContain("coding");
    },
  );

  it("should mark o- models as legacy for OpenAI provider", () => {
    const openaiConfig: AIGatewayProviderConfig.Type = {
      apiKey: "NOT_NEEDED",
      cacheIdentifier: "openai",
      id: AIProviderConfigIdSchema.parse("openai"),
      type: "openai",
    };
    const model = createMockModel("openai/o-1");
    const result = addHeuristicTags(model, openaiConfig);
    expect(result.tags).toContain("legacy");
  });

  it("should not mark o- models as legacy for non-OpenAI providers", () => {
    const model = createMockModel("openai/o-1");
    const result = addHeuristicTags(model, mockConfig);
    expect(result.tags).not.toContain("legacy");
  });

  it("should return default, recommended, and coding tags for instrument author", () => {
    const model = createMockModel(OUR_MODELS.text.id);
    const result = addHeuristicTags(model, mockConfig);
    expect(result.tags).toEqual(["recommended", "coding", "default"]);
  });

  it("should preserve existing tags and add heuristic tags", () => {
    const model = createMockModel("test-author/gpt-5.5", ["new"]);
    const result = addHeuristicTags(model, mockConfig);
    expect(result.tags).toEqual(["new", "coding", "recommended"]);
  });
});

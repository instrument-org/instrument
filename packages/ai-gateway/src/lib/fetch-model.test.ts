import { beforeEach, describe, expect, it, vi } from "vitest";

import { type AIGatewayModel } from "../schemas/model";
import { AIGatewayModelURI } from "../schemas/model-uri";
import { type AIGatewayProviderConfig } from "../schemas/provider-config";
import { fetchModel } from "./fetch-model";
import { type ModelCache } from "./model-cache";

const { fetchAndParseAnthropicModels } = vi.hoisted(() => ({
  fetchAndParseAnthropicModels: vi.fn(),
}));

vi.mock("./fetch-models/anthropic", () => ({ fetchAndParseAnthropicModels }));

function AIProviderConfigId(id: string): AIGatewayProviderConfig.Type["id"] {
  // Branded ID; a bare string is fine for this test.
  return id as AIGatewayProviderConfig.Type["id"];
}

const config: AIGatewayProviderConfig.Type = {
  apiKey: "test-key",
  cacheIdentifier: "anthropic",
  id: AIProviderConfigId("anthropic"),
  type: "anthropic",
};

const MODEL_URI = AIGatewayModelURI.Schema.parse(
  `anthropic/claude?provider=anthropic&providerConfigId=${config.id}`,
);
const OTHER_MODEL_URI = AIGatewayModelURI.Schema.parse(
  `anthropic/other?provider=anthropic&providerConfigId=${config.id}`,
);

// The fetcher is mocked, so only `uri` matters to the resolution under test.
const FETCHED = [
  { name: "claude", uri: MODEL_URI },
] as unknown as AIGatewayModel.Type[];
const CACHED = [
  { name: "claude-cached", uri: MODEL_URI },
] as unknown as AIGatewayModel.Type[];

function createMemoryCache(seed?: AIGatewayModel.Type[]): ModelCache {
  const store = new Map<string, AIGatewayModel.Type[]>();
  if (seed) {
    store.set(config.cacheIdentifier, seed);
  }
  return {
    read: (id) => store.get(id),
    write: (id, models) => store.set(id, models),
  };
}

const captureException = vi.fn();

describe("fetchModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves from the cache without going to the provider", async () => {
    const result = await fetchModel({
      captureException,
      configs: [config],
      modelCache: createMemoryCache(CACHED),
      modelURI: MODEL_URI,
    });

    expect(result.getOrNull()).toEqual(CACHED[0]);
    expect(fetchAndParseAnthropicModels).not.toHaveBeenCalled();
  });

  it("fetches when the cache is cold", async () => {
    fetchAndParseAnthropicModels.mockResolvedValue(FETCHED);

    const result = await fetchModel({
      captureException,
      configs: [config],
      modelCache: createMemoryCache(),
      modelURI: MODEL_URI,
    });

    expect(result.getOrNull()).toEqual(FETCHED[0]);
    expect(fetchAndParseAnthropicModels).toHaveBeenCalledOnce();
  });

  it("fetches when the cache holds other models but not this one", async () => {
    fetchAndParseAnthropicModels.mockResolvedValue([
      ...FETCHED,
      { name: "other", uri: OTHER_MODEL_URI },
    ]);

    const result = await fetchModel({
      captureException,
      configs: [config],
      modelCache: createMemoryCache(CACHED),
      modelURI: OTHER_MODEL_URI,
    });

    expect(result.getOrNull()).toMatchObject({ uri: OTHER_MODEL_URI });
    expect(fetchAndParseAnthropicModels).toHaveBeenCalledOnce();
  });

  it("errors when neither the cache nor the provider has the model", async () => {
    fetchAndParseAnthropicModels.mockResolvedValue(FETCHED);

    const result = await fetchModel({
      captureException,
      configs: [config],
      modelCache: createMemoryCache(),
      modelURI: OTHER_MODEL_URI,
    });

    expect(result.ok).toBe(false);
  });
});

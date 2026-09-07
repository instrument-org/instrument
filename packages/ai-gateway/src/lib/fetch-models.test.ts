import { beforeEach, describe, expect, it, vi } from "vitest";

import { AIGatewayModel } from "../schemas/model";
import { AIGatewayModelURI } from "../schemas/model-uri";
import { type AIGatewayProviderConfig } from "../schemas/provider-config";
import { TypedError } from "./errors";
import { fetchModelsForProvider } from "./fetch-models";
import { type ModelCache } from "./model-cache";

const { fetchAndParseAnthropicModels } = vi.hoisted(() => ({
  fetchAndParseAnthropicModels: vi.fn(),
}));

vi.mock("./fetch-models/anthropic", () => ({ fetchAndParseAnthropicModels }));

const config: AIGatewayProviderConfig.Type = {
  apiKey: "test-key",
  cacheIdentifier: "anthropic",
  id: AIProviderConfigId("anthropic"),
  type: "anthropic",
};

function AIProviderConfigId(id: string): AIGatewayProviderConfig.Type["id"] {
  // Branded ID; a bare string is fine for this test.
  return id as AIGatewayProviderConfig.Type["id"];
}

// The fetcher is mocked, so what these carry beyond `canonicalId` and `tags` --
// which the variant and supersession rules read on the way through to the cache
// -- goes unread. Whole models even so: what this path now drops is a model it
// cannot represent, and a stand-in missing half its fields is one of those.
function model(name: string): AIGatewayModel.Type {
  const params = { provider: config.type, providerConfigId: config.id };
  return AIGatewayModel.Schema.parse({
    author: "anthropic",
    canonicalId: name,
    features: ["inputText", "outputText", "tools"],
    name,
    params,
    providerId: `anthropic/${name}`,
    providerName: "Anthropic",
    tags: [],
    uri: AIGatewayModelURI.fromModel({
      author: "anthropic",
      canonicalId: AIGatewayModel.CanonicalIdSchema.parse(name),
      params,
    }),
  });
}

const MODELS = [model("claude")];
const CACHED = [model("claude-cached")];

function createMemoryCache(seed?: AIGatewayModel.Type[]): ModelCache & {
  store: Map<string, AIGatewayModel.Type[]>;
} {
  const store = new Map<string, AIGatewayModel.Type[]>();
  if (seed) {
    store.set(config.cacheIdentifier, seed);
  }
  return {
    read: (id) => store.get(id),
    store,
    write: (id, models) => store.set(id, models),
  };
}

const captureException = vi.fn();

describe("fetchModelsForProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes to the cache on a successful fetch", async () => {
    fetchAndParseAnthropicModels.mockResolvedValue(MODELS);
    const cache = createMemoryCache();

    const result = await fetchModelsForProvider(config, {
      captureException,
      modelCache: cache,
    });

    expect(result.getOrNull()).toEqual(MODELS);
    expect(cache.store.get(config.cacheIdentifier)).toEqual(MODELS);
  });

  // The list is validated as a whole where it leaves for the renderer, so an
  // entry carrying a field the model schema refuses used to take every other
  // model in the response with it: the app reported having no models at all,
  // over one bad value, and offered nothing to do about it.
  it("drops a model it cannot represent and keeps the rest", async () => {
    // A catalog entry that says it has no context at all. Nothing else about it
    // is wrong, and a length of zero is not a length.
    const noContext = { ...model("no-context"), contextLength: 0 };
    fetchAndParseAnthropicModels.mockResolvedValue([...MODELS, noContext]);
    const cache = createMemoryCache();

    const result = await fetchModelsForProvider(config, {
      captureException,
      modelCache: cache,
    });

    expect(result.getOrNull()).toEqual(MODELS);
    expect(cache.store.get(config.cacheIdentifier)).toEqual(MODELS);
    // And says which one went, since a catalog that grew a shape we cannot read
    // is worth hearing about rather than quietly serving one model short.
    expect(String(captureException.mock.calls[0]?.[0])).toContain(
      "anthropic/no-context",
    );
  });

  it("does not overwrite cached models when the fetch returns an empty list", async () => {
    fetchAndParseAnthropicModels.mockResolvedValue([]);
    const cache = createMemoryCache(CACHED);

    const result = await fetchModelsForProvider(config, {
      captureException,
      modelCache: cache,
    });

    expect(result.getOrNull()).toEqual([]);
    expect(cache.store.get(config.cacheIdentifier)).toEqual(CACHED);
  });

  it("falls back to cached models when the fetch fails transiently", async () => {
    fetchAndParseAnthropicModels.mockRejectedValue(
      new TypeError("fetch failed"),
    );
    const cache = createMemoryCache(CACHED);

    const result = await fetchModelsForProvider(config, {
      captureException,
      modelCache: cache,
    });

    expect(result.getOrNull()).toEqual(CACHED);
  });

  it("falls back to cached models on a transient HTTP status", async () => {
    fetchAndParseAnthropicModels.mockRejectedValue(
      new TypedError.Fetch("Failed to fetch from https://example.test/models", {
        cause: new TypedError.Fetch(
          "Failed to fetch from https://example.test/models: 503 Service Unavailable",
          { status: 503 },
        ),
      }),
    );
    const cache = createMemoryCache(CACHED);

    const result = await fetchModelsForProvider(config, {
      captureException,
      modelCache: cache,
    });

    expect(result.getOrNull()).toEqual(CACHED);
  });

  it("returns the error on an auth HTTP status even with a cache", async () => {
    fetchAndParseAnthropicModels.mockRejectedValue(
      new TypedError.Fetch("Failed to fetch from https://example.test/models", {
        cause: new TypedError.Fetch(
          "Failed to fetch from https://example.test/models: 401 Unauthorized",
          { status: 401 },
        ),
      }),
    );
    const cache = createMemoryCache(CACHED);

    const result = await fetchModelsForProvider(config, {
      captureException,
      modelCache: cache,
    });

    expect(result.ok).toBe(false);
  });

  it("returns the error when parsing fails even with a cache", async () => {
    fetchAndParseAnthropicModels.mockRejectedValue(
      new TypedError.Parse("invalid response"),
    );
    const cache = createMemoryCache(CACHED);

    const result = await fetchModelsForProvider(config, {
      captureException,
      modelCache: cache,
    });

    expect(result.ok).toBe(false);
  });

  it("returns the error when the fetch fails and there is no cache", async () => {
    fetchAndParseAnthropicModels.mockRejectedValue(
      new TypeError("fetch failed"),
    );
    const cache = createMemoryCache();

    const result = await fetchModelsForProvider(config, {
      captureException,
      modelCache: cache,
    });

    expect(result.ok).toBe(false);
  });
});

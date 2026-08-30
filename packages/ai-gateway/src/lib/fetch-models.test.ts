import { beforeEach, describe, expect, it, vi } from "vitest";

import { type AIGatewayModel } from "../schemas/model";
import { type AIGatewayProviderConfig } from "../schemas/provider-config";
import { TypedError } from "./errors";
import { fetchModelsForProvider } from "./fetch-models";
import { type ModelCache } from "./model-cache";

const { fetchAndParseAnthropicModels } = vi.hoisted(() => ({
  fetchAndParseAnthropicModels: vi.fn(),
}));

vi.mock("./fetch-models/anthropic", () => ({ fetchAndParseAnthropicModels }));

// The fetcher is mocked, so only `canonicalId` matters, and only because the
// variant rule reads it on the way through to the cache.
const MODELS = [
  { canonicalId: "claude", name: "claude" },
] as unknown as AIGatewayModel.Type[];
const CACHED = [
  { canonicalId: "claude-cached", name: "claude-cached" },
] as unknown as AIGatewayModel.Type[];

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

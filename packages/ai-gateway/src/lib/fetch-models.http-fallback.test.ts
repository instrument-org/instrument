import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type AIGatewayModel } from "../schemas/model";
import { AIGatewayProviderConfig } from "../schemas/provider-config";
import { clearCachedResults } from "./cache";
import { fetchModelsForProvider } from "./fetch-models";
import { type ModelCache } from "./model-cache";

// Exercises the whole path from an HTTP status answered by the provider down
// to the cache-fallback decision, with only the network stubbed.
const CACHED = [
  { canonicalId: "claude-cached", name: "claude-cached" },
] as unknown as AIGatewayModel.Type[];

const config = AIGatewayProviderConfig.Schema.parse({
  apiKey: "test-key",
  cacheIdentifier: "anthropic",
  id: "anthropic",
  type: "anthropic",
});

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

describe("fetchModelsForProvider on an HTTP error status", () => {
  beforeEach(() => {
    clearCachedResults();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to cached models when the provider answers 503", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("Service Unavailable", {
        status: 503,
        statusText: "Service Unavailable",
      }),
    );

    const result = await fetchModelsForProvider(config, {
      captureException,
      modelCache: createMemoryCache(CACHED),
    });

    expect(result.getOrNull()).toEqual(CACHED);
  });

  it("falls back to cached models when the provider answers 429", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("Too Many Requests", {
        status: 429,
        statusText: "Too Many Requests",
      }),
    );

    const result = await fetchModelsForProvider(config, {
      captureException,
      modelCache: createMemoryCache(CACHED),
    });

    expect(result.getOrNull()).toEqual(CACHED);
  });

  it("stays loud when the provider answers 401 even with a cache", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("Unauthorized", {
        status: 401,
        statusText: "Unauthorized",
      }),
    );

    const result = await fetchModelsForProvider(config, {
      captureException,
      modelCache: createMemoryCache(CACHED),
    });

    expect(result.ok).toBe(false);
  });
});

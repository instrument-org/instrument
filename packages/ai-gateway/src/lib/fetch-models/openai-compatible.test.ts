import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AIGatewayProviderConfig } from "../../schemas/provider-config";
import { clearCachedResults } from "../cache";
import { fetchOpenAICompatibleModels } from "./openai-compatible";

const ollamaConfig = AIGatewayProviderConfig.Schema.parse({
  apiKey: "not-needed",
  cacheIdentifier: "test-ollama",
  id: "test-ollama-config-id",
  type: "ollama",
});

const togetherConfig = AIGatewayProviderConfig.Schema.parse({
  apiKey: "test-key",
  cacheIdentifier: "test-together",
  id: "test-together-config-id",
  type: "together",
});

describe("fetchOpenAICompatibleModels", () => {
  beforeEach(() => {
    clearCachedResults();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ data: [] }), { status: 200 }),
        ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not cache model lists for providers that default to localhost", async () => {
    await fetchOpenAICompatibleModels(ollamaConfig);
    await fetchOpenAICompatibleModels(ollamaConfig);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("honors cache: false for a remote provider", async () => {
    await fetchOpenAICompatibleModels(togetherConfig, { cache: false });
    await fetchOpenAICompatibleModels(togetherConfig, { cache: false });

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("caches model lists for remote providers by default", async () => {
    await fetchOpenAICompatibleModels(togetherConfig);
    await fetchOpenAICompatibleModels(togetherConfig);

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

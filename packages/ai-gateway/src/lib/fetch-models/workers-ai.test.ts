import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AIGatewayProviderConfig } from "../../schemas/provider-config";
import {
  workersAiTestAccountId,
  workersAiTestOpenAiCompatBaseUrl,
} from "../../test/workers-ai-fixtures";
import modelsPageFixture from "../../test/workers-ai-models-page.json";
import { clearCachedResults } from "../cache";
import {
  isWorkersAiProviderConfig,
  workersAiModelsSearchUrl,
} from "./parse-workers-ai-base-url";
import {
  fetchAndParseWorkersAiModels,
  verifyWorkersAiApiKey,
  workersAiTextGenerationTask,
} from "./workers-ai";

const workersAiConfig = AIGatewayProviderConfig.Schema.parse({
  apiKey: "test-token",
  baseURL: workersAiTestOpenAiCompatBaseUrl,
  cacheIdentifier: "test-cache",
  id: "test-config-id",
  type: "openai-compatible",
});

const modelsSearchURL = workersAiModelsSearchUrl(workersAiTestAccountId, {
  per_page: 100,
  task: workersAiTextGenerationTask,
});

function modelsSearchResponse(data: ReturnType<typeof openRouterModel>[]) {
  return { data };
}

function openRouterModel({
  id,
  name,
  outputModalities = ["text"],
  supported_features,
}: {
  id: string;
  name: string;
  outputModalities?: string[];
  supported_features?: string[];
}) {
  return {
    created: 1_700_000_000,
    description: name,
    id,
    input_modalities: ["text"],
    name,
    output_modalities: outputModalities,
    ...(supported_features ? { supported_features } : {}),
  };
}

describe("isWorkersAiProviderConfig", () => {
  it.each([
    {
      baseURL: workersAiTestOpenAiCompatBaseUrl,
      expected: true,
      label: "canonical URL",
    },
    {
      baseURL: `${workersAiTestOpenAiCompatBaseUrl}/`,
      expected: true,
      label: "trailing slash",
    },
    {
      baseURL: "https://api.openai.com/v1",
      expected: false,
      label: "OpenAI",
    },
    {
      baseURL: "https://api.cloudflare.com/client/v4/accounts/abc/ai/v1/extra",
      expected: false,
      label: "extra path segment",
    },
    {
      baseURL: "https://api.cloudflare.com/client/v4/accounts/abc/ai/run/model",
      expected: false,
      label: "native run endpoint",
    },
  ])("matches $label", ({ baseURL, expected }) => {
    expect(
      isWorkersAiProviderConfig({
        baseURL,
        type: "openai-compatible",
      }),
    ).toBe(expected);
  });
});

describe("fetchAndParseWorkersAiModels", () => {
  beforeEach(() => {
    clearCachedResults();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads text-generation chat models from Cloudflare models/search", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify(
          modelsSearchResponse([
            openRouterModel({
              id: "@cf/moonshotai/kimi-k2.6",
              name: "Kimi K2.6",
            }),
            openRouterModel({
              id: "@cf/meta/llama-4-scout-17b-16e-instruct",
              name: "Llama 4 Scout",
            }),
            openRouterModel({
              id: "@cf/qwen/qwen3-embedding-0.6b",
              name: "Qwen3 Embedding 0.6B",
              outputModalities: ["embeddings"],
            }),
          ]),
        ),
        { status: 200 },
      ),
    );

    const result = await fetchAndParseWorkersAiModels(workersAiConfig);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(fetch).toHaveBeenCalledWith(modelsSearchURL, {
      headers: expect.any(Headers),
      method: "GET",
      signal: expect.any(AbortSignal),
    });
    expect(result.value.map((m) => m.providerId)).toEqual([
      "@cf/moonshotai/kimi-k2.6",
      "@cf/meta/llama-4-scout-17b-16e-instruct",
    ]);
  });

  it("maps tool support from supported_features", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify(
          modelsSearchResponse([
            openRouterModel({
              id: "@cf/openai/gpt-oss-120b",
              name: "OpenAI: Gpt Oss 120B",
              supported_features: ["tools"],
            }),
          ]),
        ),
        { status: 200 },
      ),
    );
    const result = await fetchAndParseWorkersAiModels(workersAiConfig);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.map((m) => m.providerId)).toEqual([
      "@cf/openai/gpt-oss-120b",
    ]);
    expect(result.value[0]?.features).toContain("tools");
  });

  it("paginates until a page returns fewer than per_page results", async () => {
    const pageOneModels = Array.from({ length: 100 }, (_, index) =>
      openRouterModel({
        id: `@cf/meta/model-${index}`,
        name: `Model ${index}`,
      }),
    );

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify(modelsSearchResponse(pageOneModels)), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            modelsSearchResponse([
              openRouterModel({
                id: "@cf/openai/gpt-oss-120b",
                name: "GPT OSS 120B",
              }),
            ]),
          ),
          { status: 200 },
        ),
      );

    const result = await fetchAndParseWorkersAiModels(workersAiConfig);

    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    if (!result.ok) {
      return;
    }

    expect(result.value).toHaveLength(101);
    expect(
      result.value.some((m) => m.providerId === "@cf/openai/gpt-oss-120b"),
    ).toBe(true);
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      workersAiModelsSearchUrl(workersAiTestAccountId, {
        page: 2,
        per_page: 100,
        task: workersAiTextGenerationTask,
      }),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("parses real API fixture correctly", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(modelsPageFixture), { status: 200 }),
    );

    const result = await fetchAndParseWorkersAiModels(workersAiConfig);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.map((m) => m.providerId)).toMatchInlineSnapshot(`
      [
        "@cf/openai/gpt-oss-120b",
        "@cf/meta/llama-3.2-11b-vision-instruct",
        "@cf/meta/llama-3.2-3b-instruct",
        "@cf/qwen/qwq-32b",
      ]
    `);
    expect(
      result.value.map((m) => ({ features: m.features, id: m.providerId })),
    ).toMatchInlineSnapshot(`
      [
        {
          "features": [
            "inputText",
            "inputFile",
            "outputText",
            "tools",
          ],
          "id": "@cf/openai/gpt-oss-120b",
        },
        {
          "features": [
            "inputText",
            "inputFile",
            "inputImage",
            "outputText",
          ],
          "id": "@cf/meta/llama-3.2-11b-vision-instruct",
        },
        {
          "features": [
            "inputText",
            "inputFile",
            "outputText",
          ],
          "id": "@cf/meta/llama-3.2-3b-instruct",
        },
        {
          "features": [
            "inputText",
            "inputFile",
            "outputText",
          ],
          "id": "@cf/qwen/qwq-32b",
        },
      ]
    `);
  });
});

describe("verifyWorkersAiApiKey", () => {
  beforeEach(() => {
    clearCachedResults();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the Cloudflare models search API with a bearer token", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(modelsSearchResponse([])), {
        status: 200,
      }),
    );

    const result = await verifyWorkersAiApiKey(workersAiConfig);

    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      workersAiModelsSearchUrl(workersAiTestAccountId, {
        hide_experimental: true,
        per_page: 1,
        task: workersAiTextGenerationTask,
      }),
      {
        headers: expect.any(Headers),
        method: "GET",
        signal: expect.any(AbortSignal),
      },
    );

    const headers = vi.mocked(fetch).mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer test-token");
  });

  it("fails when Cloudflare returns an HTTP error", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    );

    const result = await verifyWorkersAiApiKey(workersAiConfig);

    expect(result.ok).toBe(false);
  });

  it("fails when Cloudflare returns a non-OpenRouter-shaped body", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ errors: [{ code: 10_000 }], success: false }),
        {
          status: 200,
        },
      ),
    );

    const result = await verifyWorkersAiApiKey(workersAiConfig);

    expect(result.ok).toBe(false);
  });
});

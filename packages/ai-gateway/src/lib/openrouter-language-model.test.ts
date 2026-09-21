import { createOpenAI } from "@ai-sdk/openai";
import { type LanguageModelV4 } from "@ai-sdk/provider";
import {
  type AIProviderConfigId,
  OUR_PROVIDER_CONFIG,
  type WorkspaceServerURL,
} from "@instrument-org/shared";
import { wrapLanguageModel } from "ai";
import { describe, expect, it, vi } from "vitest";

import { type AIGatewayProviderConfig } from "../schemas/provider-config";
import { providerOptionsForModel } from "./ai-sdk-provider-options";
import {
  createOpenRouterLanguageModel,
  isServedThroughResponses,
  openRouterResponsesMiddleware,
} from "./openrouter-language-model";

const openrouterConfig: AIGatewayProviderConfig.Type = {
  apiKey: "test-key",
  cacheIdentifier: "openrouter-cache-id",
  // Branded id; a bare string is fine for this test.
  id: "openrouter" as AIProviderConfigId,
  type: "openrouter",
};

const ourConfig: AIGatewayProviderConfig.Type = {
  apiKey: "test-key",
  cacheIdentifier: OUR_PROVIDER_CONFIG.cacheIdentifier,
  id: OUR_PROVIDER_CONFIG.id,
  type: OUR_PROVIDER_CONFIG.type,
};

const workspaceServerURL = "http://localhost:1" as WorkspaceServerURL;

/**
 * Captures the body a provider would have sent and then fails the request, so
 * a test can read the wire without a network call or a stubbed response shape.
 */
function bodyCapture() {
  const seen: { body?: Record<string, unknown>; headers?: Headers } = {};
  const fetch = (_url: RequestInfo | URL, init?: RequestInit) => {
    seen.headers = new Headers(init?.headers);
    const rawBody =
      init?.body instanceof ArrayBuffer
        ? new TextDecoder().decode(init.body)
        : (init?.body as string);
    seen.body = JSON.parse(rawBody) as Record<string, unknown>;
    return Promise.reject(new Error("captured"));
  };
  return { fetch, seen };
}

function responsesModel(
  config: AIGatewayProviderConfig.Type,
  fetch: ReturnType<typeof bodyCapture>["fetch"],
) {
  return wrapLanguageModel({
    middleware: openRouterResponsesMiddleware(config),
    model: createOpenAI({ apiKey: "test", fetch }).responses(
      "openai/gpt-5.6-luna",
    ),
  });
}

describe("isServedThroughResponses", () => {
  it.each([
    ["openai/gpt-5.6-luna", true],
    ["openai/gpt-4.1-mini", true],
    ["instrument/auto", true],
    ["anthropic/claude-sonnet-5", false],
    ["google/gemini-3.8-flash", false],
    ["openrouter/auto", false],
  ])("%s -> %s", (modelId, expected) => {
    expect(isServedThroughResponses(modelId)).toBe(expected);
  });
});

describe("createOpenRouterLanguageModel", () => {
  it("hands OpenAI models and our aliases to the Responses model and the rest to chat", async () => {
    const chat = (modelId: string): LanguageModelV4 => ({
      doGenerate: () => Promise.reject(new Error("not called")),
      doStream: () => Promise.reject(new Error("not called")),
      modelId,
      provider: "openrouter",
      specificationVersion: "v4",
      supportedUrls: {},
    });
    const languageModel = await createOpenRouterLanguageModel({
      chat,
      config: ourConfig,
      workspaceServerURL,
    });

    expect(languageModel("openai/gpt-5.6-luna").provider).toBe(
      "openai.responses",
    );
    expect(languageModel("instrument/auto").provider).toBe("openai.responses");
    expect(languageModel("anthropic/claude-sonnet-5").provider).toBe(
      "openrouter",
    );
  });

  it("sends the app attribution the chat path sends", async () => {
    const { fetch, seen } = bodyCapture();
    vi.stubGlobal("fetch", fetch);
    try {
      const languageModel = await createOpenRouterLanguageModel({
        chat: () => {
          throw new Error("not called");
        },
        config: openrouterConfig,
        workspaceServerURL,
      });
      await expect(
        languageModel("openai/gpt-5.6-luna").doGenerate({
          prompt: [{ content: [{ text: "hi", type: "text" }], role: "user" }],
        }),
      ).rejects.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }

    expect({
      referer: seen.headers?.get("http-referer"),
      title: seen.headers?.get("x-openrouter-title"),
    }).toMatchInlineSnapshot(`
      {
        "referer": "https://tryinstrument.com",
        "title": "Instrument",
      }
    `);
  });
});

describe("the Responses request on the wire", () => {
  const reasoning = {
    efforts: ["low", "medium", "high"],
    enabledByDefault: true,
    mandatory: false,
  };

  it("never asks OpenRouter to store, and names the config's cache identifier as the user", async () => {
    const { fetch, seen } = bodyCapture();
    const luna = responsesModel(openrouterConfig, fetch);

    await expect(
      luna.doGenerate({
        prompt: [{ content: [{ text: "hi", type: "text" }], role: "user" }],
        providerOptions: providerOptionsForModel(luna, {
          effort: "low",
          reasoning,
        }),
      }),
    ).rejects.toThrow();

    expect(seen.body).toMatchObject({
      include: ["reasoning.encrypted_content"],
      model: "openai/gpt-5.6-luna",
      reasoning: { effort: "low", summary: "auto" },
      store: false,
      user: "openrouter-cache-id",
    });
  });

  it("sends no user for our own provider, whose gateway names the user itself", async () => {
    const { fetch, seen } = bodyCapture();
    const luna = responsesModel(ourConfig, fetch);

    await expect(
      luna.doGenerate({
        prompt: [{ content: [{ text: "hi", type: "text" }], role: "user" }],
        providerOptions: providerOptionsForModel(luna, { reasoning }),
      }),
    ).rejects.toThrow();

    expect(seen.body).toMatchObject({ store: false });
    expect(seen.body).not.toHaveProperty("user");
  });

  it("replays an earlier reply whole, with its phase, rather than by reference", async () => {
    const { fetch, seen } = bodyCapture();
    const luna = responsesModel(ourConfig, fetch);

    await expect(
      luna.doGenerate({
        prompt: [
          {
            content: [{ text: "Connect PostHog", type: "text" }],
            role: "user",
          },
          {
            content: [
              {
                providerOptions: {
                  openai: { itemId: "msg_tmp_1", phase: "final_answer" },
                },
                text: "PostHog is connected and ready to use.",
                type: "text",
              },
            ],
            role: "assistant",
          },
          { content: [{ text: "Thanks", type: "text" }], role: "user" },
        ],
        providerOptions: providerOptionsForModel(luna, { reasoning }),
      }),
    ).rejects.toThrow();

    // No item id: with nothing stored upstream, an id is a reference no one
    // can resolve.
    expect(seen.body?.input).toContainEqual({
      content: "PostHog is connected and ready to use.",
      phase: "final_answer",
      role: "assistant",
    });
  });
});

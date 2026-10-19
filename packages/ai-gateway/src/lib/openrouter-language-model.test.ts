import { createOpenAI } from "@ai-sdk/openai";
import {
  type LanguageModelV4,
  type LanguageModelV4Prompt,
} from "@ai-sdk/provider";
import {
  type AIProviderConfigId,
  OUR_PROVIDER_CONFIG,
  type WorkspaceServerURL,
} from "@instrument-org/shared";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
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
    ["openai/gpt-5.6-luna", undefined, true],
    ["openai/gpt-4.1-mini", undefined, true],
    ["instrument/auto", "openai/gpt-6-luna", true],
    ["instrument/auto", undefined, true],
    ["instrument/auto", "anthropic/claude-haiku-5.5", false],
    ["instrument/claude", "anthropic/claude-haiku-5.5", false],
    ["instrument/gemini", "google/gemini-3.8-flash", false],
    ["instrument/grok", "x-ai/grok-4.7", false],
    ["instrument/muse", "meta/muse-spark-1.3", false],
    ["anthropic/claude-sonnet-5", undefined, false],
    ["google/gemini-3.8-flash", undefined, false],
    ["openrouter/auto", undefined, false],
  ])("%s resolving to %s -> %s", (modelId, sourceModelId, expected) => {
    expect(isServedThroughResponses(modelId, sourceModelId)).toBe(expected);
  });
});

describe("createOpenRouterLanguageModel", () => {
  it("hands OpenAI models and the aliases resolving to one to the Responses model and the rest to chat", async () => {
    const chat = (modelId: string): LanguageModelV4 => ({
      doGenerate: () => Promise.reject(new Error("not called")),
      doStream: () => Promise.reject(new Error("not called")),
      modelId,
      provider: "openrouter",
      specificationVersion: "v4",
      supportedUrls: {},
    });
    const sourceModelIds: Record<string, string> = {
      "instrument/auto": "openai/gpt-6-luna",
      "instrument/claude": "anthropic/claude-haiku-5.5",
    };
    const languageModel = await createOpenRouterLanguageModel({
      chat,
      config: ourConfig,
      sourceModelIdOf: (modelId) => sourceModelIds[modelId],
      workspaceServerURL,
    });

    expect(
      Object.fromEntries(
        [
          "openai/gpt-5.6-luna",
          "instrument/auto",
          "instrument/claude",
          "instrument/unlisted",
          "anthropic/claude-sonnet-5",
        ].map((modelId) => [modelId, languageModel(modelId).provider]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "anthropic/claude-sonnet-5": "openrouter",
        "instrument/auto": "openai.responses",
        "instrument/claude": "openrouter",
        "instrument/unlisted": "openai.responses",
        "openai/gpt-5.6-luna": "openai.responses",
      }
    `);
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

/**
 * One turn as the Responses path stores it, the way workspace replays it once
 * the alias has moved to another model: the encrypted reasoning is already
 * stripped, so the reasoning part carries only its summary, while the text and
 * the call still carry their Responses item ids and phases.
 */
const responsesShapedHistory: LanguageModelV4Prompt = [
  { content: [{ text: "Read test.txt", type: "text" }], role: "user" },
  {
    content: [
      { text: "Looking for the file.", type: "reasoning" },
      {
        providerOptions: {
          openai: { itemId: "msg_commentary", phase: "commentary" },
        },
        text: "I'll read it.",
        type: "text",
      },
      {
        input: { filePath: "test.txt" },
        providerOptions: { openai: { itemId: "fc_read" } },
        toolCallId: "call_read",
        toolName: "read_file",
        type: "tool-call",
      },
    ],
    role: "assistant",
  },
  {
    content: [
      {
        output: { type: "text", value: "file contents" },
        toolCallId: "call_read",
        toolName: "read_file",
        type: "tool-result",
      },
    ],
    role: "tool",
  },
  {
    content: [
      {
        providerOptions: {
          openai: { itemId: "msg_final", phase: "final_answer" },
        },
        text: "It says file contents.",
        type: "text",
      },
    ],
    role: "assistant",
  },
  { content: [{ text: "Thanks", type: "text" }], role: "user" },
];

/**
 * The same turn as the chat path stores it: OpenRouter's reasoning details on
 * the reasoning part and the call, which the Responses path has no slot for.
 */
const chatShapedHistory: LanguageModelV4Prompt = [
  { content: [{ text: "Read test.txt", type: "text" }], role: "user" },
  {
    content: [
      {
        providerOptions: {
          openrouter: {
            reasoning_details: [
              {
                format: "anthropic-claude-v1",
                signature: "sig",
                text: "Looking for the file.",
                type: "reasoning.text",
              },
            ],
          },
        },
        text: "Looking for the file.",
        type: "reasoning",
      },
      {
        input: { filePath: "test.txt" },
        toolCallId: "toolu_read",
        toolName: "read_file",
        type: "tool-call",
      },
    ],
    role: "assistant",
  },
  {
    content: [
      {
        output: { type: "text", value: "file contents" },
        toolCallId: "toolu_read",
        toolName: "read_file",
        type: "tool-result",
      },
    ],
    role: "tool",
  },
  { content: [{ text: "Thanks", type: "text" }], role: "user" },
];

describe("an alias that moves between shapes mid-conversation", () => {
  async function bodyFor(sourceModelId: string, prompt: LanguageModelV4Prompt) {
    const { fetch, seen } = bodyCapture();
    vi.stubGlobal("fetch", fetch);
    try {
      const languageModel = await createOpenRouterLanguageModel({
        chat: createOpenRouter({ apiKey: "test", fetch }),
        config: ourConfig,
        sourceModelIdOf: () => sourceModelId,
        workspaceServerURL,
      });
      await expect(
        languageModel("instrument/auto").doGenerate({ prompt }),
      ).rejects.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
    return seen.body;
  }

  it("replays a Responses-path turn on the chat path without its item ids, phases or reasoning", async () => {
    const body = await bodyFor(
      "anthropic/claude-haiku-5.5",
      responsesShapedHistory,
    );

    expect(body?.messages).toMatchInlineSnapshot(`
      [
        {
          "content": "Read test.txt",
          "role": "user",
        },
        {
          "content": "I'll read it.",
          "role": "assistant",
          "tool_calls": [
            {
              "function": {
                "arguments": "{"filePath":"test.txt"}",
                "name": "read_file",
              },
              "id": "call_read",
              "type": "function",
            },
          ],
        },
        {
          "content": "file contents",
          "name": "read_file",
          "role": "tool",
          "tool_call_id": "call_read",
        },
        {
          "content": "It says file contents.",
          "role": "assistant",
        },
        {
          "content": "Thanks",
          "role": "user",
        },
      ]
    `);
  });

  it("replays a chat-path turn on the Responses path without OpenRouter's reasoning details", async () => {
    const body = await bodyFor("openai/gpt-6-luna", chatShapedHistory);

    expect(body?.input).toMatchInlineSnapshot(`
      [
        {
          "content": [
            {
              "text": "Read test.txt",
              "type": "input_text",
            },
          ],
          "role": "user",
        },
        {
          "arguments": "{"filePath":"test.txt"}",
          "call_id": "toolu_read",
          "name": "read_file",
          "type": "function_call",
        },
        {
          "call_id": "toolu_read",
          "output": "file contents",
          "type": "function_call_output",
        },
        {
          "content": [
            {
              "text": "Thanks",
              "type": "input_text",
            },
          ],
          "role": "user",
        },
      ]
    `);
  });
});

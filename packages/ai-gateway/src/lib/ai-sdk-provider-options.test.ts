import { createAnthropic } from "@ai-sdk/anthropic";
import { type LanguageModelV3 } from "@ai-sdk/provider";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { describe, expect, it } from "vitest";

import { providerOptionsForModel } from "./ai-sdk-provider-options";

/**
 * Captures the body a provider would have sent and then fails the request, so
 * a test can read the wire without a network call or a stubbed response shape.
 */
function bodyCapture() {
  const seen: { body?: Record<string, unknown> } = {};
  const fetch = (_url: RequestInfo | URL, init?: RequestInit) => {
    const rawBody = init?.body instanceof ArrayBuffer ? new TextDecoder().decode(init.body) : (init?.body as string);
    seen.body = JSON.parse(rawBody) as Record<string, unknown>;
    return Promise.reject(new Error("captured"));
  };
  return { fetch, seen };
}

const HELLO = [
  { content: [{ text: "hi", type: "text" as const }], role: "user" as const },
];

function model(provider: string, modelId: string): LanguageModelV3 {
  const unused = () => {
    throw new Error("not called");
  };
  return {
    doGenerate: unused,
    doStream: unused,
    modelId,
    provider,
    specificationVersion: "v3",
    supportedUrls: {},
  };
}

describe("providerOptionsForModel", () => {
  it("asks for nothing extra when no level is named", () => {
    expect(
      providerOptionsForModel(model("openrouter", "openai/gpt-5.6-luna")),
    ).toEqual({});
  });

  it("carries a level alongside the flags a model already needed", () => {
    expect(
      providerOptionsForModel(model("openai.responses", "gpt-5.6-luna"), {
        effort: "low",
        reasoning: { efforts: [], enabledByDefault: true, mandatory: false },
      }),
    ).toEqual({
      openai: {
        include: ["reasoning.encrypted_content"],
        reasoningEffort: "low",
        store: false,
      },
    });
  });

  it("leaves the encrypted-content flags alone for a model that cannot take a level", () => {
    expect(
      providerOptionsForModel(model("openai.responses", "gpt-5.6-luna"), {
        effort: "low",
      }),
    ).toEqual({
      openai: { include: ["reasoning.encrypted_content"], store: false },
    });
  });

  it("names the model's own provider rather than the one asking", () => {
    expect(
      providerOptionsForModel(
        model("openrouter", "anthropic/claude-sonnet-5"),
        {
          effort: "low",
        },
      ),
    ).toEqual({ openrouter: { reasoning: { effort: "low" } } });
  });
});

describe("the level on the wire", () => {
  it("reaches an OpenRouter-shaped request as its own reasoning object", async () => {
    const { fetch, seen } = bodyCapture();
    const sdk = createOpenRouter({ apiKey: "test", fetch });
    const luna = sdk("openai/gpt-5.6-luna");

    await expect(
      luna.doGenerate({
        prompt: HELLO,
        providerOptions: providerOptionsForModel(luna, { effort: "low" }),
      }),
    ).rejects.toThrow();

    expect(seen.body).toMatchObject({ reasoning: { effort: "low" } });
  });

  it("reaches a direct Anthropic request as an output config", async () => {
    const { fetch, seen } = bodyCapture();
    const sdk = createAnthropic({ apiKey: "test", fetch });
    const sonnet = sdk("claude-sonnet-5");

    await expect(
      sonnet.doGenerate({
        prompt: HELLO,
        providerOptions: providerOptionsForModel(sonnet, {
          effort: "low",
          reasoning: { efforts: [], enabledByDefault: true, mandatory: false },
        }),
      }),
    ).rejects.toThrow();

    expect(seen.body).toMatchObject({ output_config: { effort: "low" } });
  });
});

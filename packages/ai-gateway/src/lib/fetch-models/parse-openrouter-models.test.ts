import { describe, expect, it } from "vitest";

import { AIGatewayProviderConfig } from "../../schemas/provider-config";
import { parseOpenRouterModelsList } from "./parse-openrouter-models";

const config = AIGatewayProviderConfig.Schema.parse({
  apiKey: "test-key",
  cacheIdentifier: "test-cache",
  id: "test-config-id",
  type: "openrouter",
});

function openRouterModel(overrides: Record<string, unknown> = {}) {
  return {
    architecture: {
      input_modalities: ["text"],
      output_modalities: ["text"],
      tokenizer: "Grok",
    },
    created: 1_700_000_000,
    description: "A model",
    id: "x-ai/grok-4.3",
    name: "xAI: Grok 4.3",
    supported_parameters: ["tools"],
    ...overrides,
  };
}

function parseOne(model: Record<string, unknown>) {
  const models = parseOpenRouterModelsList({
    config,
    data: { data: [model] },
  }).getOrThrow();
  const parsed = models[0];
  if (!parsed) {
    throw new Error("expected a model");
  }
  return parsed;
}

describe("parseOpenRouterModelsList", () => {
  it("carries a restriction through from the gateway", () => {
    expect(
      parseOne(
        openRouterModel({
          instrument: {
            restricted: {
              message: "Grok 4.3 is available with a paid Instrument plan.",
              reason: "paid-plan-required",
            },
          },
        }),
      ).restricted,
    ).toMatchInlineSnapshot(`
      {
        "message": "Grok 4.3 is available with a paid Instrument plan.",
        "reason": "paid-plan-required",
      }
    `);
  });

  it("leaves restricted unset when the gateway sends no restriction", () => {
    expect(parseOne(openRouterModel()).restricted).toBeUndefined();
  });

  it("leaves restricted unset for a provider that omits the namespace", () => {
    expect(
      parseOne(openRouterModel({ instrument: {} })).restricted,
    ).toBeUndefined();
  });

  it("accepts a reason this client does not know", () => {
    expect(
      parseOne(
        openRouterModel({
          instrument: {
            restricted: {
              message: "Not right now.",
              reason: "some-future-criterion",
            },
          },
        }),
      ).restricted?.reason,
    ).toBe("some-future-criterion");
  });
});

import { describe, expect, it } from "vitest";

import { OUR_PROVIDER_CONFIG } from "@instrument-org/shared";

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
  it("grants inputFile to a text model, since OpenRouter parses PDFs itself", () => {
    expect(parseOne(openRouterModel()).features).toMatchInlineSnapshot(`
      [
        "inputText",
        "inputFile",
        "outputText",
        "tools",
      ]
    `);
  });

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

  it("carries the model our alias resolves to, and nothing for a model without one", () => {
    expect({
      alias: parseOne(
        openRouterModel({
          id: "instrument/auto",
          instrument: { sourceModelId: "openai/gpt-6-luna" },
          name: "Instrument: Auto",
        }),
      ).sourceModelId,
      plain: parseOne(openRouterModel()).sourceModelId,
    }).toEqual({ alias: "openai/gpt-6-luna", plain: undefined });
  });

  it("drops batch variants and keeps the model they mirror", () => {
    const models = parseOpenRouterModelsList({
      config,
      data: {
        data: [
          openRouterModel(),
          openRouterModel({
            id: "x-ai/grok-4.3:batch",
            name: "xAI: Grok 4.3 (batch)",
          }),
          openRouterModel({
            id: "anthropic/claude-opus-5:batch",
            name: "Claude Opus 5 (batch)",
          }),
        ],
      },
    }).getOrThrow();

    expect(models.map((model) => model.providerId)).toMatchInlineSnapshot(`
      [
        "x-ai/grok-4.3",
      ]
    `);
  });

  it("skips a model with a malformed id and keeps the rest of the list", () => {
    const models = parseOpenRouterModelsList({
      config,
      data: {
        data: [
          openRouterModel({ id: "slashless-id", name: "Slashless" }),
          openRouterModel(),
        ],
      },
    }).getOrThrow();

    expect(models.map((model) => model.providerId)).toMatchInlineSnapshot(`
      [
        "x-ai/grok-4.3",
      ]
    `);
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

  const ourConfig = AIGatewayProviderConfig.Schema.parse({
    ...OUR_PROVIDER_CONFIG,
    apiKey: "test-key",
  });

  function ourModel(id: string, instrument: Record<string, unknown>) {
    return openRouterModel({
      id: `instrument/${id}`,
      instrument,
      name: `Instrument: ${id}`,
    });
  }

  function displayDetails(data: Record<string, unknown>[]) {
    return parseOpenRouterModelsList({ config: ourConfig, data: { data } })
      .getOrThrow()
      .map(({ family, maker, name, note, providerId, restricted, tags }) => ({
        family,
        maker,
        name,
        note,
        providerId,
        restricted,
        tags,
      }));
  }

  it("reads the prompt size a hosted model's price rises at", () => {
    const [auto] = parseOpenRouterModelsList({
      config: ourConfig,
      data: {
        data: [
          {
            ...ourModel("auto", {
              name: "Auto",
              recommended: true,
              sourceModelId: "anthropic/claude-haiku-5.5",
            }),
            context_length: 1_000_000,
            pricing: {
              completion: "0.0000005",
              input_cache_read: "0.00000001",
              overrides: [
                {
                  completion: "0.0000025",
                  input_cache_read: "0.00000005",
                  min_prompt_tokens: 100_000,
                  prompt: "0.0000005",
                },
              ],
              prompt: "0.0000001",
            },
          },
        ],
      },
    }).getOrThrow();
    expect({
      canonicalId: auto?.canonicalId,
      pricing: auto?.pricing,
      sourceModelId: auto?.sourceModelId,
    }).toMatchInlineSnapshot(`
      {
        "canonicalId": "auto",
        "pricing": {
          "higherPriceFromPromptTokens": 100000,
          "input": 0.1,
          "output": 0.5,
        },
        "sourceModelId": "anthropic/claude-haiku-5.5",
      }
    `);
  });

  // One snapshot over both shapes, since an inline snapshot cannot sit inside
  // `it.each`: the gateway that curates the lineup, and the one production
  // runs until it does.
  it("reads display details from a curating gateway and leaves an older one to the heuristics", () => {
    expect({
      curated: displayDetails([
        ourModel("auto", {
          name: "Auto",
          recommended: true,
          sourceModelId: "openai/gpt-6-luna",
        }),
        ourModel("claude", {
          family: "Claude Haiku",
          maker: "anthropic",
          name: "Claude",
          note: "Fast on short edits.",
          recommended: false,
          sourceModelId: "anthropic/claude-haiku-5.5",
        }),
      ]),
      older: displayDetails([
        ourModel("auto", { sourceModelId: "openai/gpt-6-luna" }),
        openRouterModel({
          instrument: {
            restricted: {
              message: "Grok 4.3 is available with a paid Instrument plan.",
              reason: "paid-plan-required",
            },
          },
        }),
      ]),
    }).toMatchInlineSnapshot(`
      {
        "curated": [
          {
            "family": undefined,
            "maker": undefined,
            "name": "Auto",
            "note": undefined,
            "providerId": "instrument/auto",
            "restricted": undefined,
            "tags": [
              "coding",
              "default",
              "recommended",
            ],
          },
          {
            "family": "Claude Haiku",
            "maker": "anthropic",
            "name": "Claude",
            "note": "Fast on short edits.",
            "providerId": "instrument/claude",
            "restricted": undefined,
            "tags": [
              "coding",
            ],
          },
        ],
        "older": [
          {
            "family": undefined,
            "maker": undefined,
            "name": "auto",
            "note": undefined,
            "providerId": "instrument/auto",
            "restricted": undefined,
            "tags": [
              "recommended",
              "coding",
              "default",
            ],
          },
          {
            "family": undefined,
            "maker": undefined,
            "name": "Grok 4.3",
            "note": undefined,
            "providerId": "x-ai/grok-4.3",
            "restricted": {
              "message": "Grok 4.3 is available with a paid Instrument plan.",
              "reason": "paid-plan-required",
            },
            "tags": [],
          },
        ],
      }
    `);
  });
});

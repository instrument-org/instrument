import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AIGatewayModel } from "../schemas/model";
import { AIGatewayProviderConfig } from "../schemas/provider-config";
import { clearCachedResults } from "./cache";
import { fetchAndParseAnthropicModels } from "./fetch-models/anthropic";
import { fetchAndParseGoogleModels } from "./fetch-models/google";
import { fetchAndParseOpenAIModels } from "./fetch-models/openai";
import { parseOpenRouterModelsList } from "./fetch-models/parse-openrouter-models";
import { fetchAndParseXAIModels } from "./fetch-models/xai";
import {
  applyServedModelSettings,
  choiceProviderOptions,
  modelChoicesFor,
  takenChoice,
} from "./model-choices";
import { noteReportedFastMode } from "./reported-fast-mode";

function model(
  provider: string,
  extra: Record<string, unknown> = {},
): AIGatewayModel.Type {
  const params = { provider, providerConfigId: "pc_1" };
  return AIGatewayModel.Schema.parse({
    author: "maker",
    canonicalId: "some-model",
    features: ["inputText", "outputText"],
    name: "Some Model",
    params,
    providerId: "some-model",
    providerName: "Provider",
    tags: [],
    uri: `maker/some-model?provider=${provider}&providerConfigId=pc_1`,
    ...extra,
  });
}

const account = model("claude-account", {
  fast: {},
  reasoning: {
    defaultEffort: "medium",
    efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    enabledByDefault: true,
    mandatory: false,
  },
});
const choice = {
  effort: "high",
  fast: true,
  model: AIGatewayModel.CanonicalIdSchema.parse("some-model"),
  provider: "claude-account",
};

beforeEach(() => {
  noteReportedFastMode("pc_1", undefined);
  applyServedModelSettings({
    connections: {
      "claude-account": { labels: { xhigh: "Extra" } },
      google: {
        models: { "some-model": { efforts: ["low", "high", "xhigh"] } },
      },
      openai: {
        models: {
          "some-model": {
            defaultEffort: "low",
            efforts: ["none", "low", "max"],
            fast: { param: "priority" },
          },
        },
        refusedEfforts: ["max"],
      },
    },
  });
});

describe("modelChoicesFor", () => {
  it("offers an account's own levels under the names our API gives", () => {
    const choices = modelChoicesFor(account);
    expect(choices?.efforts.map(({ label }) => label)).toEqual([
      "Low",
      "Medium",
      "High",
      "Extra",
      "Max",
    ]);
    expect(choices?.defaultLabel).toBe("Medium");
  });

  it("leaves out levels the connection refuses or the SDK cannot send", () => {
    expect(
      modelChoicesFor(model("google"))?.efforts.map(({ id }) => id),
    ).toEqual(["low", "high"]);
    // One level left is no choice, and Fast still is.
    expect(modelChoicesFor(model("openai"))).toMatchObject({
      efforts: [],
      fast: {},
    });
  });

  it("offers nothing where nothing is known, and keeps the last settings over ones it cannot read", () => {
    expect(modelChoicesFor(model("x-ai"))).toBeUndefined();
    expect(applyServedModelSettings({ connections: "gone" })).toBe(false);
    expect(modelChoicesFor(model("google"))).toBeDefined();
  });

  it("says why Claude turned Fast off", () => {
    noteReportedFastMode("pc_1", "extra_usage_disabled");
    expect(modelChoicesFor(account)?.fast?.off?.row).toBe(
      "Usage credits are off",
    );
    noteReportedFastMode("pc_1", "network_error");
    expect(modelChoicesFor(account)?.fast?.off?.row).toBe("Not available");
  });
});

describe("takenChoice", () => {
  it("takes nothing made for another model or connection", () => {
    expect(takenChoice(account, choice)).toEqual({
      effort: "high",
      fast: true,
    });
    expect(takenChoice(account, { ...choice, provider: "anthropic" })).toEqual(
      {},
    );
    expect(
      takenChoice(account, {
        ...choice,
        model: AIGatewayModel.CanonicalIdSchema.parse("other"),
      }),
    ).toEqual({});
  });

  it("drops a level the model lost and Fast its account cannot run", () => {
    noteReportedFastMode("pc_1", "free");
    expect(takenChoice(account, { ...choice, effort: "ultra" })).toEqual({});
  });
});

it("asks each provider in its own words", () => {
  const taken = { effort: "max", fast: true as const };
  expect(
    ["anthropic.messages", "openai.responses", "claude-account"].map((id) =>
      choiceProviderOptions(id, taken),
    ),
  ).toEqual([
    { anthropic: { effort: "max", speed: "fast" } },
    {
      openai: {
        reasoningEffort: "max",
        reasoningSummary: null,
        serviceTier: "priority",
      },
    },
    { "claude-account": { effort: "max", fast: true } },
  ]);
});

/** A connection's models, read from a list in the shape its provider answers. */
async function listed(
  type: string,
  body: unknown,
): Promise<AIGatewayModel.Type[]> {
  const config = AIGatewayProviderConfig.Schema.parse({
    apiKey: "test-key",
    cacheIdentifier: `choices-${type}`,
    id: `choices-${type}`,
    type,
  });
  if (type === "openrouter") {
    return parseOpenRouterModelsList({ config, data: body }).getOrThrow();
  }
  clearCachedResults();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body)))),
  );
  const fetchModels = {
    anthropic: fetchAndParseAnthropicModels,
    google: fetchAndParseGoogleModels,
    openai: fetchAndParseOpenAIModels,
    "x-ai": fetchAndParseXAIModels,
  }[type];
  return fetchModels ? (await fetchModels(config)).getOrThrow() : [];
}

describe("the models a provider's own list names", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const anthropicModel = (id: string) => ({
    created_at: "2026-09-21T00:00:00Z",
    display_name: id,
    id,
    type: "model",
  });
  const openaiModel = (id: string) => ({
    created: 1_700_000_000,
    id,
    object: "model",
    owned_by: "system",
  });

  it.each([
    {
      body: {
        models: [
          {
            displayName: "Gemini 4 Neon",
            inputTokenLimit: 1_000_000,
            name: "models/gemini-4-neon",
            outputTokenLimit: 65_536,
            supportedGenerationMethods: ["generateContent"],
            version: "001",
          },
        ],
      },
      served: "gemini-4-neon",
      type: "google",
    },
    {
      body: { data: [openaiModel("gpt-5-2025-08-07")] },
      served: "gpt-5",
      type: "openai",
    },
    {
      body: { data: [openaiModel("gpt-5")] },
      served: "gpt-5",
      type: "openai",
    },
    {
      body: {
        data: [anthropicModel("claude-opus-5-5-20260921")],
        has_more: false,
      },
      served: "claude-opus-5-5",
      type: "anthropic",
    },
    {
      body: {
        models: [
          {
            created: 1_700_000_000,
            id: "grok-4.5",
            input_modalities: ["text"],
          },
        ],
      },
      served: "grok-4.5",
      type: "x-ai",
    },
  ])(
    "finds what $type is served for $served",
    async ({ body, served, type }) => {
      applyServedModelSettings({
        connections: {
          [type]: { models: { [served]: { efforts: ["low", "high"] } } },
        },
      });
      const [found] = await listed(type, body);
      expect(
        found && modelChoicesFor(found)?.efforts.map(({ id }) => id),
      ).toEqual(["low", "high"]);
    },
  );

  it.each([
    "gpt-5-mini",
    "gpt-5-mini-2025-08-07",
    "gpt-5-0807",
    "gpt-5-latest",
  ])("does not take %s for gpt-5", async (id) => {
    applyServedModelSettings({
      connections: {
        openai: { models: { "gpt-5": { efforts: ["low", "high"] } } },
      },
    });
    const [found] = await listed("openai", { data: [openaiModel(id)] });
    expect(found).toBeDefined();
    expect(found && modelChoicesFor(found)).toBeUndefined();
  });

  it("prefers a snapshot's own settings", async () => {
    applyServedModelSettings({
      connections: {
        openai: {
          models: {
            "gpt-5": { efforts: ["low", "high"] },
            "gpt-5-2025-08-07": { efforts: ["medium", "high"] },
          },
        },
      },
    });
    const [found] = await listed("openai", {
      data: [openaiModel("gpt-5-2025-08-07")],
    });
    expect(
      found && modelChoicesFor(found)?.efforts.map(({ id }) => id),
    ).toEqual(["medium", "high"]);
  });

  it("offers the levels OpenRouter lists, and names a default only where it reasons unasked", async () => {
    const openrouterModel = (id: string, reasoning?: object) => ({
      architecture: {
        input_modalities: ["text"],
        output_modalities: ["text"],
        tokenizer: "Other",
      },
      created: 1_700_000_000,
      description: "",
      id,
      name: id,
      reasoning,
      supported_parameters: ["tools"],
    });
    const models = await listed("openrouter", {
      data: [
        openrouterModel("anthropic/claude-opus-5.5", {
          default_effort: "xhigh",
          mandatory: true,
          supported_efforts: ["max", "xhigh", "high", "medium", "low", "none"],
        }),
        openrouterModel("deepseek/off-by-default", {
          default_effort: "high",
          supported_efforts: ["max", "high", "low", "none"],
        }),
        openrouterModel("vendor/unnamed-levels", { mandatory: true }),
        openrouterModel("vendor/one-level", { supported_efforts: ["high"] }),
        openrouterModel("vendor/no-reasoning"),
      ],
    });
    expect(
      models.map((entry) => {
        const choices = modelChoicesFor(entry);
        return [
          entry.providerId,
          choices?.efforts.map(({ id }) => id),
          choices?.defaultLabel,
        ];
      }),
    ).toEqual([
      [
        "anthropic/claude-opus-5.5",
        ["low", "medium", "high", "xhigh", "max"],
        "Extra High",
      ],
      ["deepseek/off-by-default", ["low", "high", "max"], undefined],
      ["vendor/unnamed-levels", undefined, undefined],
      ["vendor/one-level", undefined, undefined],
      ["vendor/no-reasoning", undefined, undefined],
    ]);
  });
});

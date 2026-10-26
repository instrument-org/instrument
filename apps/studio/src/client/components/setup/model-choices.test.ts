import {
  AIGatewayModel,
  AIGatewayModelURI,
} from "@instrument-org/ai-gateway/schemas";
import { AIProviderConfigIdSchema, OUR_MODELS } from "@instrument-org/shared";
import { describe, expect, it } from "vitest";

import {
  choosableModels,
  isShortList,
  longListGroups,
  modelsOfConnection,
  recommendedModel,
  shortList,
} from "./model-choices";

function model({
  author = "openai",
  canonicalId,
  family,
  maker,
  name,
  provider = "openrouter",
  replacedBy,
  restricted,
  tags = [],
}: {
  author?: string;
  canonicalId: string;
  family?: string;
  maker?: string;
  name: string;
  provider?: "instrument" | "openrouter";
  replacedBy?: string;
  restricted?: boolean;
  tags?: string[];
}) {
  const params = {
    provider,
    providerConfigId: AIProviderConfigIdSchema.parse(provider),
  };
  return AIGatewayModel.Schema.parse({
    author,
    canonicalId,
    family,
    features: [],
    maker,
    name,
    params,
    providerId:
      canonicalId === "auto" ? OUR_MODELS.text.id : `${author}/${canonicalId}`,
    providerName: provider === "instrument" ? "Instrument" : "OpenRouter",
    tags,
    ...(replacedBy && { replacedBy }),
    ...(restricted && {
      restricted: { message: "Needs a paid plan.", reason: "plan" },
    }),
    uri: AIGatewayModelURI.fromModel({
      author,
      canonicalId: AIGatewayModel.CanonicalIdSchema.parse(canonicalId),
      params,
    }),
  });
}

const ours = (
  canonicalId: string,
  name: string,
  maker?: string,
  tags: string[] = [],
) =>
  model({
    author: OUR_MODELS.author,
    canonicalId,
    maker,
    name,
    provider: "instrument",
    tags,
  });

const instrumentPlan = [
  ours("claude", "Claude", "anthropic"),
  ours("auto", "Auto", undefined, ["default", "recommended"]),
  ours("gpt", "ChatGPT", "openai"),
];

const openRouter = [
  model({
    author: "anthropic",
    canonicalId: "claude-sonnet-5.5",
    name: "Claude Sonnet 5.5",
    tags: ["default", "recommended"],
  }),
  model({
    author: "anthropic",
    canonicalId: "claude-haiku-5.5",
    name: "Claude Haiku 5.5",
  }),
  model({
    author: "anthropic",
    canonicalId: "claude-opus-5.5",
    name: "Claude Opus 5.5",
  }),
  model({
    author: "openai",
    canonicalId: "gpt-5.5",
    name: "GPT-5.5",
    tags: ["recommended"],
  }),
  model({
    author: "google",
    canonicalId: "gemini-3-pro",
    name: "Gemini 3 Pro",
    tags: ["recommended"],
  }),
  model({
    author: "google",
    canonicalId: "gemini-3-flash",
    name: "Gemini 3 Flash",
  }),
  model({
    author: "google",
    canonicalId: "gemini-3-flash-lite",
    name: "Gemini 3 Flash Lite",
  }),
  model({
    author: "deepseek",
    canonicalId: "deepseek-v4",
    name: "DeepSeek V4",
  }),
  model({
    author: "deepseek",
    canonicalId: "deepseek-v3",
    name: "DeepSeek V3",
    replacedBy: "deepseek-v4",
  }),
  model({ author: "openai", canonicalId: "o9", name: "o9", restricted: true }),
];

const names = (groups: { label: string; models: { name: string }[] }[]) =>
  groups.map(
    (group) => `${group.label}: ${group.models.map((m) => m.name).join(", ")}`,
  );

describe("setup's model choices", () => {
  it("offers neither replaced nor out-of-reach models", () => {
    expect(choosableModels(openRouter).map((m) => m.name)).not.toContain("o9");
    expect(choosableModels(openRouter).map((m) => m.name)).not.toContain(
      "DeepSeek V3",
    );
  });

  it("recommends the default already set, else what the default would be", () => {
    expect(recommendedModel(instrumentPlan, undefined)?.name).toBe("Auto");
    expect(recommendedModel(instrumentPlan, instrumentPlan[2]?.uri)?.name).toBe(
      "ChatGPT",
    );
    expect(recommendedModel(openRouter, "gone")?.name).toBe(
      "Claude Sonnet 5.5",
    );
  });

  it("lists a plan's few models whole, the recommended one first", () => {
    expect(isShortList(instrumentPlan)).toBe(true);
    expect(
      shortList(
        instrumentPlan,
        recommendedModel(instrumentPlan, undefined),
      ).map((m) => m.name),
    ).toEqual(["Auto", "Claude", "ChatGPT"]);
  });

  it("opens a long list on suggestions, then every maker", () => {
    const models = choosableModels(openRouter);
    expect(isShortList(models)).toBe(false);
    expect(
      names(
        longListGroups({
          models,
          query: "",
          recommended: recommendedModel(models, undefined),
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "Suggested: Claude Sonnet 5.5, GPT-5.5, Gemini 3 Pro",
        "Anthropic: Claude Haiku 5.5, Claude Opus 5.5",
        "DeepSeek: DeepSeek V4",
        "Google: Gemini 3 Flash, Gemini 3 Flash Lite",
      ]
    `);
  });

  it("searches every model and keeps matches under their maker", () => {
    const models = choosableModels(openRouter);
    expect(
      names(
        longListGroups({ models, query: "gemini", recommended: models[0] }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "Google: Gemini 3 Flash, Gemini 3 Flash Lite, Gemini 3 Pro",
      ]
    `);
    expect(
      longListGroups({ models, query: "zzzz", recommended: models[0] }),
    ).toEqual([]);
  });

  it("lists the connection just made, else every connection", () => {
    const models = choosableModels([...instrumentPlan, ...openRouter]);
    const key = AIProviderConfigIdSchema.parse("openrouter");
    expect(
      modelsOfConnection(models, {
        kind: "sign-in",
        provider: "instrument",
      }).map((m) => m.name),
    ).toEqual(["Claude", "Auto", "ChatGPT"]);
    expect(
      modelsOfConnection(models, { kind: "key", providerConfigId: key }),
    ).toHaveLength(8);
    expect(modelsOfConnection(models, undefined)).toBe(models);
    // Grok's models not listed yet: none, which the model step waits on.
    expect(
      modelsOfConnection(models, { kind: "sign-in", provider: "grok" }),
    ).toEqual([]);
  });

  it("groups several connections' long list by connection", () => {
    const models = choosableModels([...instrumentPlan, ...openRouter]);
    expect(
      names(
        longListGroups({
          models,
          query: "",
          recommended: recommendedModel(models, undefined),
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "Suggested: Auto, Claude Sonnet 5.5, GPT-5.5",
        "Instrument: ChatGPT, Claude",
        "OpenRouter: Claude Haiku 5.5, Claude Opus 5.5, DeepSeek V4, Gemini 3 Flash, Gemini 3 Flash Lite, Gemini 3 Pro",
      ]
    `);
  });
});

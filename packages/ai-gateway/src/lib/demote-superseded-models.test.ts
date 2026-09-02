import { OUR_MODELS } from "@instrument-org/shared";
import { describe, expect, it } from "vitest";

import { AIGatewayModel } from "../schemas/model";
import { AIGatewayModelURI } from "../schemas/model-uri";
import { demoteSupersededModels } from "./demote-superseded-models";

function createModel(
  providerId: string,
  tags: AIGatewayModel.ModelTag[] = ["coding", "recommended"],
): AIGatewayModel.Type {
  const [author = "test-author", rawCanonicalId = providerId] =
    providerId.split("/");
  const canonicalId = AIGatewayModel.CanonicalIdSchema.parse(rawCanonicalId);
  const params = {
    provider: "openrouter" as const,
    providerConfigId:
      AIGatewayModelURI.ParamsSchema.shape.providerConfigId.parse(
        "openrouter-config-id",
      ),
  };
  return {
    author,
    canonicalId,
    features: [],
    name: canonicalId,
    params,
    providerId: AIGatewayModel.ProviderIdSchema.parse(providerId),
    providerName: "Test Provider",
    tags,
    uri: AIGatewayModelURI.fromModel({ author, canonicalId, params }),
  };
}

function stillRecommended(models: AIGatewayModel.Type[]) {
  return demoteSupersededModels(models)
    .filter((model) => model.tags.includes("recommended"))
    .map((model) => model.canonicalId);
}

describe("demoteSupersededModels", () => {
  it("keeps one release of each series a provider lists", () => {
    expect(
      stillRecommended([
        createModel("deepseek/deepseek-v4-flash"),
        createModel("deepseek/deepseek-v4-flash-0731"),
        createModel("deepseek/deepseek-v4-flash-latest"),
        createModel("deepseek/deepseek-v4-pro"),
        createModel("deepseek/deepseek-v4-pro-0813"),
      ]),
    ).toMatchInlineSnapshot(`
      [
        "deepseek-v4-flash-0731",
        "deepseek-v4-pro-0813",
      ]
    `);
  });

  it("keeps only the family's current generation across its tiers", () => {
    expect(
      stillRecommended([
        createModel("anthropic/claude-opus-5"),
        createModel("anthropic/claude-sonnet-5"),
        createModel("anthropic/claude-fable-5"),
        createModel("anthropic/claude-haiku-4.5"),
      ]),
    ).toMatchInlineSnapshot(`
      [
        "claude-opus-5",
        "claude-sonnet-5",
        "claude-fable-5",
      ]
    `);
  });

  it("leaves a family alone when one line takes a point release", () => {
    expect(
      stillRecommended([
        createModel("anthropic/claude-fable-5.1"),
        createModel("anthropic/claude-opus-5"),
        createModel("anthropic/claude-sonnet-5"),
        createModel("anthropic/claude-haiku-4.5"),
      ]),
    ).toMatchInlineSnapshot(`
      [
        "claude-fable-5.1",
        "claude-opus-5",
        "claude-sonnet-5",
      ]
    `);
  });

  it("reads a tier spelled after the version the same way", () => {
    expect(
      stillRecommended([
        createModel("google/gemini-3.1-pro-preview"),
        createModel("google/gemini-3.1-flash-lite"),
        createModel("google/gemini-3.5-flash"),
        createModel("google/gemini-3.5-flash-lite"),
        createModel("google/gemini-3.6-flash"),
        createModel("google/gemini-3.7-flash"),
      ]),
    ).toMatchInlineSnapshot(`
      [
        "gemini-3.7-flash",
      ]
    `);
  });

  it("surfaces a tier the moment it catches up to its family", () => {
    expect(
      stillRecommended([
        createModel("google/gemini-3.1-pro-preview"),
        createModel("google/gemini-3.7-flash"),
        createModel("google/gemini-3.7-pro"),
      ]),
    ).toMatchInlineSnapshot(`
      [
        "gemini-3.7-flash",
        "gemini-3.7-pro",
      ]
    `);
  });

  it("keeps a small tier that ships at its family's generation", () => {
    expect(
      stillRecommended([
        createModel("anthropic/claude-opus-5"),
        createModel("anthropic/claude-haiku-5"),
      ]),
    ).toMatchInlineSnapshot(`
      [
        "claude-opus-5",
        "claude-haiku-5",
      ]
    `);
  });

  it("reads a suffixed line as the same family", () => {
    expect(
      stillRecommended([
        createModel("moonshotai/kimi-k2.6"),
        createModel("moonshotai/kimi-k2.7-code"),
        createModel("moonshotai/kimi-k3"),
      ]),
    ).toMatchInlineSnapshot(`
      [
        "kimi-k3",
      ]
    `);
  });

  it("prefers the plainer of two ids for one release", () => {
    expect(
      stillRecommended([
        createModel("minimax/minimax-m3"),
        createModel("minimax/minimax-m3:free"),
      ]),
    ).toMatchInlineSnapshot(`
      [
        "minimax-m3",
      ]
    `);
  });

  it("takes the default tag along with recommended", () => {
    const [, superseded] = demoteSupersededModels([
      createModel("z-ai/glm-5.3"),
      createModel("z-ai/glm-5.2", ["coding", "recommended", "default"]),
    ]);

    expect(superseded?.tags).toMatchInlineSnapshot(`
      [
        "coding",
      ]
    `);
  });

  it("leaves a model nothing in the list supersedes", () => {
    expect(
      stillRecommended([
        createModel("x-ai/grok-4.6"),
        createModel("openai/gpt-5.6-luna"),
        createModel("openai/gpt-5.6-terra"),
      ]),
    ).toMatchInlineSnapshot(`
      [
        "grok-4.6",
        "gpt-5.6-luna",
        "gpt-5.6-terra",
      ]
    `);
  });

  it("ignores a model that was never recommended", () => {
    expect(
      demoteSupersededModels([
        createModel("z-ai/glm-5.3"),
        createModel("z-ai/glm-5.2", ["coding"]),
      ]).map((model) => model.tags),
    ).toMatchInlineSnapshot(`
      [
        [
          "coding",
          "recommended",
        ],
        [
          "coding",
        ],
      ]
    `);
  });

  it("leaves our own catalog alone", () => {
    expect(
      stillRecommended([
        createModel("x-ai/grok-4.6"),
        createModel(`${OUR_MODELS.author}/auto-image-2`),
      ]),
    ).toMatchInlineSnapshot(`
      [
        "grok-4.6",
        "auto-image-2",
      ]
    `);
  });

  it("leaves an unversioned id alone", () => {
    expect(
      stillRecommended([
        createModel("openrouter/auto"),
        createModel("openai/gpt-5.6-luna"),
      ]),
    ).toMatchInlineSnapshot(`
      [
        "auto",
        "gpt-5.6-luna",
      ]
    `);
  });
});

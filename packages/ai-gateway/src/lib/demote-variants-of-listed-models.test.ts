import { describe, expect, it } from "vitest";

import { AIGatewayModel } from "../schemas/model";
import { AIGatewayModelURI } from "../schemas/model-uri";
import { demoteVariantsOfListedModels } from "./demote-variants-of-listed-models";

function createModel(
  providerId: string,
  tags: AIGatewayModel.ModelTag[],
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

function tagsById(models: AIGatewayModel.Type[]) {
  return Object.fromEntries(
    models.map((model) => [model.canonicalId, model.tags]),
  );
}

describe("demoteVariantsOfListedModels", () => {
  it("demotes a variant whose base is in the same list", () => {
    const result = demoteVariantsOfListedModels([
      createModel("openai/gpt-5.5", ["coding", "recommended"]),
      createModel("openai/gpt-5.5-pro", ["coding", "recommended"]),
    ]);

    expect(tagsById(result)).toMatchInlineSnapshot(`
      {
        "gpt-5.5": [
          "coding",
          "recommended",
        ],
        "gpt-5.5-pro": [
          "coding",
        ],
      }
    `);
  });

  it("leaves a variant alone when its base is not listed", () => {
    const result = demoteVariantsOfListedModels([
      createModel("deepseek/deepseek-v4-pro", ["coding", "recommended"]),
      createModel("deepseek/deepseek-v4-flash", ["coding", "recommended"]),
    ]);

    expect(tagsById(result)).toMatchInlineSnapshot(`
      {
        "deepseek-v4-flash": [
          "coding",
          "recommended",
        ],
        "deepseek-v4-pro": [
          "coding",
          "recommended",
        ],
      }
    `);
  });

  it("takes the default tag as well as recommended", () => {
    const result = demoteVariantsOfListedModels([
      createModel("anthropic/claude-opus-5", ["coding", "recommended"]),
      createModel("anthropic/claude-opus-5-fast", [
        "coding",
        "recommended",
        "default",
      ]),
    ]);

    expect(tagsById(result)).toMatchInlineSnapshot(`
      {
        "claude-opus-5": [
          "coding",
          "recommended",
        ],
        "claude-opus-5-fast": [
          "coding",
        ],
      }
    `);
  });

  it.each([
    ["openai/gpt-5.6-terra", "openai/gpt-5.6-terra-pro"],
    [
      "google/gemini-3.1-pro-preview",
      "google/gemini-3.1-pro-preview-customtools",
    ],
    ["openai/gpt-5.1-codex", "openai/gpt-5.1-codex-max"],
    ["qwen/qwen3-max", "qwen/qwen3-max-thinking"],
    ["x-ai/grok-4.20", "x-ai/grok-4.20-multi-agent"],
  ])("demotes %s's variant %s", (base, variant) => {
    const result = demoteVariantsOfListedModels([
      createModel(base, ["coding", "recommended"]),
      createModel(variant, ["coding", "recommended"]),
    ]);

    expect(result[1]?.tags).toEqual(["coding"]);
  });

  it.each([
    "openai/gpt-5.6-luna",
    "openai/gpt-5.4-mini",
    "google/gemini-3.5-flash-lite",
    "z-ai/glm-5.3-flash",
  ])("leaves the cheaper tier %s recommended", (providerId) => {
    const result = demoteVariantsOfListedModels([
      createModel("openai/gpt-5.6", ["coding", "recommended"]),
      createModel("openai/gpt-5.4", ["coding", "recommended"]),
      createModel("google/gemini-3.5-flash", ["coding", "recommended"]),
      createModel("z-ai/glm-5.3", ["coding", "recommended"]),
      createModel(providerId, ["coding", "recommended"]),
    ]);

    expect(result.at(-1)?.tags).toEqual(["coding", "recommended"]);
  });

  it("keeps every other tag on a demoted variant", () => {
    const result = demoteVariantsOfListedModels([
      createModel("openai/gpt-5.5", ["coding", "recommended"]),
      createModel("openai/gpt-5.5-pro", [
        "coding",
        "recommended",
        "new",
        "legacy",
      ]),
    ]);

    expect(result[1]?.tags).toEqual(["coding", "new", "legacy"]);
  });
});

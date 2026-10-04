import { OUR_MODELS } from "@instrument-org/shared";
import { describe, expect, it } from "vitest";

import { AIGatewayModel } from "../schemas/model";
import { AIGatewayModelURI } from "../schemas/model-uri";
import { markReplacedModels } from "./mark-replaced-models";

function createModel(providerId: string): AIGatewayModel.Type {
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
    tags: [],
    uri: AIGatewayModelURI.fromModel({ author, canonicalId, params }),
  };
}

function replacements(ids: string[]) {
  return Object.fromEntries(
    markReplacedModels(ids.map(createModel)).map((model) => [
      model.canonicalId,
      model.replacedBy ?? null,
    ]),
  );
}

describe("markReplacedModels", () => {
  it("names the newest higher version of each series", () => {
    expect(
      replacements([
        "anthropic/claude-sonnet-4.5",
        "anthropic/claude-sonnet-5",
        "anthropic/claude-sonnet-5.5",
        "anthropic/claude-opus-5",
        "anthropic/claude-haiku-4.5",
      ]),
    ).toMatchInlineSnapshot(`
      {
        "claude-haiku-4.5": null,
        "claude-opus-5": null,
        "claude-sonnet-4.5": "claude-sonnet-5.5",
        "claude-sonnet-5": "claude-sonnet-5.5",
        "claude-sonnet-5.5": null,
      }
    `);
  });

  it("does not count a dated build or alias of the same version", () => {
    expect(
      replacements([
        "deepseek/deepseek-v4-flash",
        "deepseek/deepseek-v4-flash-0731",
        "deepseek/deepseek-v4-flash-latest",
      ]),
    ).toMatchInlineSnapshot(`
      {
        "deepseek-v4-flash": null,
        "deepseek-v4-flash-0731": null,
        "deepseek-v4-flash-latest": null,
      }
    `);
  });

  it("never offers a preview in place of a stable release", () => {
    expect(
      replacements([
        "google/gemini-3.7-flash",
        "google/gemini-3.8-flash-preview",
        "google/gemini-3.6-flash-preview",
      ]),
    ).toMatchInlineSnapshot(`
      {
        "gemini-3.6-flash-preview": "gemini-3.8-flash-preview",
        "gemini-3.7-flash": null,
        "gemini-3.8-flash-preview": null,
      }
    `);
  });

  it("leaves unversioned ids and our own catalog alone", () => {
    expect(
      replacements([
        "openai/gpt-oss-120b",
        `${OUR_MODELS.author}/claude-sonnet-5`,
        `${OUR_MODELS.author}/claude-sonnet-5.5`,
      ]),
    ).toMatchInlineSnapshot(`
      {
        "claude-sonnet-5": null,
        "claude-sonnet-5.5": null,
        "gpt-oss-120b": null,
      }
    `);
  });
});

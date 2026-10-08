import { type AIGatewayModel } from "@instrument-org/ai-gateway/client";
import { describe, expect, it } from "vitest";

import { maskKey, pickMainModels } from "./own-key-models";

function model(
  canonicalId: string,
  tags: AIGatewayModel.ModelTag[] = [],
): AIGatewayModel.Type {
  return {
    author: "test",
    canonicalId: canonicalId as AIGatewayModel.CanonicalId,
    features: [],
    name: canonicalId,
    params: { provider: "anthropic", providerConfigId: "config" as never },
    providerId: canonicalId as AIGatewayModel.ProviderId,
    providerName: "Test",
    tags,
    uri: `test/${canonicalId}?provider=anthropic&providerConfigId=config` as never,
  };
}

function picks(models: AIGatewayModel.Type[]) {
  return pickMainModels(models).map(
    ({ detail, model: { canonicalId }, recommended }) =>
      `${recommended ? "* " : ""}${canonicalId}: ${detail ?? "-"}`,
  );
}

describe("pickMainModels", () => {
  it("puts Anthropic's everyday model first, then its strongest and fastest", () => {
    expect(
      picks([
        model("claude-opus-4.1", ["legacy"]),
        model("claude-haiku-4.5", ["coding"]),
        model("claude-opus-5", ["coding", "recommended"]),
        model("claude-sonnet-5", ["coding", "default", "recommended"]),
        model("claude-fable-5", ["coding", "recommended"]),
      ]),
    ).toMatchInlineSnapshot(`
      [
        "* claude-sonnet-5: Quick and capable. Good for most work.",
        "claude-opus-5: Best for hard problems. Slower, and costs more.",
        "claude-haiku-4.5: Fastest, and costs the least.",
      ]
    `);
  });

  it("falls back to the everyday tier when nothing is tagged default", () => {
    expect(picks([model("deepseek-reasoner"), model("deepseek-chat")]))
      .toMatchInlineSnapshot(`
        [
          "* deepseek-chat: Quick and capable. Good for most work.",
          "deepseek-reasoner: Thinks before it answers, so it's slower.",
        ]
      `);
  });

  it("skips models that are not for chatting and prefers the newest release", () => {
    expect(
      picks([
        model("gemini-3-pro-image", ["coding"]),
        model("gemini-3-pro", ["coding", "recommended"]),
        model("gemini-3.5-pro", ["coding", "recommended"]),
        model("gemini-3.7-flash", ["coding", "default", "recommended"]),
        model("gemini-3.5-flash-lite", ["coding", "recommended"]),
      ]),
    ).toMatchInlineSnapshot(`
      [
        "* gemini-3.7-flash: Quick and capable. Good for most work.",
        "gemini-3.5-pro: Best for hard problems. Slower, and costs more.",
        "gemini-3.5-flash-lite: Fastest, and costs the least.",
      ]
    `);
  });

  it("describes a default with no tier in its name plainly", () => {
    expect(
      picks([
        model("gpt-5.6-terra", ["coding", "default", "recommended"]),
        model("gpt-5.6-mini", ["coding", "recommended"]),
        model("gpt-5.6-pro", ["coding", "recommended"]),
      ]),
    ).toMatchInlineSnapshot(`
      [
        "* gpt-5.6-terra: Good for most work.",
        "gpt-5.6-pro: Best for hard problems. Slower, and costs more.",
        "gpt-5.6-mini: Faster, and costs less.",
      ]
    `);
  });

  it("returns nothing for an empty list", () => {
    expect(pickMainModels([])).toEqual([]);
  });
});

describe("maskKey", () => {
  it.each([
    [
      "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789-7Qx",
      "sk-ant-api03-••••••••••••••••7Qx",
    ],
    ["sk-1234567890abc", "sk-12••••••••••••••••abc"],
    ["short", "•••••"],
  ])("masks %s", (key, masked) => {
    expect(maskKey(key)).toBe(masked);
  });
});

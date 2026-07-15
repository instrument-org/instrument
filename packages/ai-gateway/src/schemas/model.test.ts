import { describe, expect, it } from "vitest";

import { AIGatewayModel } from "./model";

function model(tags: string[]) {
  return {
    author: "x-ai",
    canonicalId: "grok-4.3",
    features: ["outputText"],
    name: "Grok 4.3",
    params: { provider: "x-ai", providerConfigId: "x-ai" },
    providerId: "x-ai/grok-4.3",
    providerName: "xAI",
    tags,
    uri: "x-ai/grok-4.3?provider=x-ai&providerConfigId=x-ai",
  };
}

describe("AIGatewayModel.Schema tags", () => {
  it("keeps recognized tags", () => {
    expect(
      AIGatewayModel.Schema.parse(model(["coding", "recommended"])).tags,
    ).toEqual(["coding", "recommended"]);
  });

  // A task recorded by a build that still wrote "premium" has to stay readable.
  it("drops a retired tag instead of failing the model", () => {
    expect(
      AIGatewayModel.Schema.parse(model(["premium", "coding"])).tags,
    ).toEqual(["coding"]);
  });

  it("drops every unknown tag without touching the rest of the model", () => {
    const parsed = AIGatewayModel.Schema.parse(model(["premium", "nonsense"]));

    expect(parsed.tags).toEqual([]);
    expect(parsed.name).toBe("Grok 4.3");
  });
});

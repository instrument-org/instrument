import { describe, expect, it } from "vitest";

import { AIGatewayModelURI } from "./model-uri";

describe("AIGatewayModelURI.parse", () => {
  it("reads the author, canonical id and params", () => {
    const result = AIGatewayModelURI.parse(
      "google/gemini-1.5-pro-002?provider=google&providerConfigId=google-config-id",
    );
    expect(result.ok && result.value).toEqual({
      author: "google",
      canonicalId: "gemini-1.5-pro-002",
      params: { provider: "google", providerConfigId: "google-config-id" },
    });
  });

  it.each([
    ["no query", "openai/gpt-4"],
    ["no author", "gpt-4?provider=openai&providerConfigId=openai-config-id"],
    ["no canonical id", "openai/?provider=openai&providerConfigId=openai-config-id"],
    ["only a query", "?provider=openai&providerConfigId=openai-config-id"],
    ["no provider", "openai/gpt-4?providerConfigId=openai-config-id"],
    ["no providerConfigId", "openai/gpt-4?provider=openai"],
    [
      "a provider type that does not exist",
      "openai/gpt-4?provider=invalid-provider&providerConfigId=openai-config-id",
    ],
  ])("refuses a URI with %s", (_, uri) => {
    expect(AIGatewayModelURI.parse(uri).ok).toBe(false);
  });
});

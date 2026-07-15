import { describe, expect, it } from "vitest";

import { modelNameFromURI } from "./model-name-from-uri";

describe("modelNameFromURI", () => {
  it.each([
    [
      "openai/gpt-5.6-luna?provider=instrument&providerConfigId=instrument",
      "GPT 5.6 Luna",
    ],
    [
      "inception/mercury-2?provider=instrument&providerConfigId=instrument",
      "Mercury 2",
    ],
    ["x-ai/grok-4.3?provider=x-ai&providerConfigId=x-ai", "Grok 4.3"],
  ])("names %s", (uri, expected) => {
    expect(modelNameFromURI(uri)).toBe(expected);
  });

  it.each([
    ["", "empty"],
    ["not-a-uri", "no author or query"],
    ["openai/gpt-5.6-luna", "no query part"],
    ["?provider=x-ai", "no path part"],
  ])("returns null for %o (%s)", (uri) => {
    expect(modelNameFromURI(uri)).toBeNull();
  });
});

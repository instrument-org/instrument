import { describe, expect, it } from "vitest";

import {
  chatGPTAccountDefaultModel,
  chatGPTAccountSearchModel,
  spaceBeforeFamily,
} from "./chatgpt";

describe("spaceBeforeFamily", () => {
  it.each([
    ["GPT-5.6-Luna", "GPT-5.6 Luna"],
    ["GPT-6-Astra", "GPT-6 Astra"],
    ["GPT-5.5", "GPT-5.5"],
    ["Codex Auto Review", "Codex Auto Review"],
  ])("%s reads as %s", (label, expected) => {
    expect(spaceBeforeFamily(label)).toBe(expected);
  });
});

describe("chatGPTAccountDefaultModel", () => {
  const ids = (...canonicalIds: string[]) =>
    canonicalIds.map((canonicalId) => ({ canonicalId }));

  it.each([
    [
      ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
      "gpt-5.6-sol",
    ],
    [["gpt-5.6-sol", "gpt-6-sol", "gpt-6.1-sol"], "gpt-6.1-sol"],
    [["gpt-6-astra", "gpt-5.6-terra", "gpt-5.6-luna"], "gpt-5.6-luna"],
    [["gpt-6-astra", "gpt-5.6-terra"], "gpt-6-astra"],
  ])("from %j picks %s", (listed, expected) => {
    expect(chatGPTAccountDefaultModel(ids(...listed))?.canonicalId).toBe(
      expected,
    );
  });
});

describe("chatGPTAccountSearchModel", () => {
  const ids = (...canonicalIds: string[]) =>
    canonicalIds.map((canonicalId) => ({ canonicalId }));

  it.each([
    [["gpt-5.6-sol", "gpt-5.6-luna", "gpt-6-luna"], "gpt-6-luna"],
    [["gpt-6-astra", "gpt-5.6-sol"], "gpt-5.6-sol"],
    [["gpt-6-astra"], undefined],
  ])("from %j picks %s", (listed, expected) => {
    expect(chatGPTAccountSearchModel(ids(...listed))?.canonicalId).toBe(
      expected,
    );
  });
});

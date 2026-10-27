import { describe, expect, it } from "vitest";

import { pricingPerMillionTokens } from "./model-pricing";

describe("pricingPerMillionTokens", () => {
  it.each([
    {
      expected: { input: 0.2, output: 1.2 },
      name: "converts per-token strings to dollars per million",
      pricing: { completion: "0.0000012", prompt: "0.0000002" },
    },
    {
      expected: { input: 0, output: 0 },
      name: "keeps a free model at zero",
      pricing: { completion: "0", prompt: "0" },
    },
    {
      expected: { input: 0.035, output: 0.14 },
      name: "keeps a tenth of a cent",
      pricing: { completion: "0.00000014", prompt: "0.000000035" },
    },
    {
      expected: undefined,
      name: "treats a negative price as unknown",
      pricing: { completion: "-1", prompt: "-1" },
    },
    {
      expected: undefined,
      name: "needs both sides",
      pricing: { prompt: "0.000001" },
    },
    {
      expected: undefined,
      name: "handles a list with no pricing",
      pricing: undefined,
    },
    {
      expected: {
        higherPriceFromPromptTokens: 100_000,
        input: 0.1,
        output: 0.5,
      },
      name: "keeps the prompt size a higher rate starts at",
      pricing: {
        completion: "0.0000005",
        overrides: [{ min_prompt_tokens: 100_000, prompt: "0.0000005" }],
        prompt: "0.0000001",
      },
    },
    {
      expected: { input: 0.1, output: 0.5 },
      name: "ignores an override that does not raise the prompt price",
      pricing: {
        completion: "0.0000005",
        overrides: [{ min_prompt_tokens: 100_000, prompt: "0.0000001" }],
        prompt: "0.0000001",
      },
    },
    {
      expected: undefined,
      name: "rejects a price that is not a number",
      pricing: { completion: "n/a", prompt: "0.000001" },
    },
  ])("$name", ({ expected, pricing }) => {
    expect(pricingPerMillionTokens(pricing)).toEqual(expected);
  });
});

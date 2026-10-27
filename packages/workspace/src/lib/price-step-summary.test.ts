import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";

import { summarizeBeforePriceStep } from "./price-step-summary";

const usage = {
  inputTokens: { cacheRead: 80, cacheWrite: 5, noCache: 15, total: 100 },
  outputTokens: { reasoning: 0, text: 20, total: 20 },
};

/** A model that writes `text` and stops for `reason`. */
function writing(text: string, reason: "length" | "stop") {
  return new MockLanguageModelV4({
    doGenerate: () =>
      Promise.resolve({
        content: [{ text, type: "text" }],
        finishReason: { raw: reason, unified: reason },
        usage,
        warnings: [],
      }),
  });
}

function summarize(model: MockLanguageModelV4) {
  return summarizeBeforePriceStep({
    activity: {},
    headers: {},
    messages: [{ content: "Plan the move.", role: "user" }],
    model,
    providerOptions: undefined,
    signal: AbortSignal.timeout(5000),
    tools: {},
  });
}

describe("summarizeBeforePriceStep", () => {
  it("keeps a summary the model finished as it wrote it", async () => {
    expect((await summarize(writing(" The goal. ", "stop")))?.summary).toBe(
      "The goal.",
    );
  });

  it("says when the length limit cut a summary off", async () => {
    expect((await summarize(writing("The goal.", "length")))?.summary)
      .toMatchInlineSnapshot(`
        "The goal.

        [This summary was cut off at its length limit. The conversation's transcript has what it does not cover.]"
      `);
  });

  it("gives nothing for a model that wrote nothing", async () => {
    expect(await summarize(writing("  ", "stop"))).toBeUndefined();
  });
});

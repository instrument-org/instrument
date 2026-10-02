import { describe, expect, it } from "vitest";

import { costOfUsage } from "./utils";

const LUNA = {
  cacheRead: 0.02e-6,
  cacheWrite: 0.25e-6,
  completion: 1.2e-6,
  prompt: 0.2e-6,
};

function usage(input: number, read: number, write: number, output: number) {
  return {
    inputTokenDetails: {
      cacheReadTokens: read,
      cacheWriteTokens: write,
      noCacheTokens: input - read,
    },
    inputTokens: input,
    outputTokens: output,
  };
}

describe("costOfUsage", () => {
  it.each([
    ["all fresh", usage(1_000_000, 0, 0, 0), 0.2],
    ["all cached", usage(1_000_000, 1_000_000, 0, 0), 0.02],
    ["all written", usage(1_000_000, 0, 1_000_000, 0), 0.25],
    ["output only", usage(0, 0, 0, 1_000_000), 1.2],
  ])("bills %s input at its own rate", (_, run, dollars) => {
    expect(costOfUsage(run, LUNA)).toBeCloseTo(dollars, 10);
  });

  it("bills cache reads at the prompt rate when no cache price is known", () => {
    expect(
      costOfUsage(usage(1_000_000, 1_000_000, 0, 0), {
        completion: 1.2e-6,
        prompt: 0.2e-6,
      }),
    ).toBeCloseTo(0.2, 10);
  });
});

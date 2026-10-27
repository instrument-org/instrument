import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../../src/schemas/session/message";
import {
  capSpendOf,
  emptyRunCost,
  billedCostOf,
  costSourceOf,
  describeCost,
  modelCostUSD,
  runCostOf,
} from "./run-cost";

const PRICE = {
  cacheRead: 0.01e-6,
  cacheWrite: 0.125e-6,
  completion: 0.5e-6,
  prompt: 0.1e-6,
};

/** One assistant step, with `usage` as the turn stored it and `parts`. */
function step(
  id: string,
  {
    aborted = false,
    parts = [],
    usage,
  }: {
    aborted?: boolean;
    parts?: unknown[];
    usage?: { input: number; output: number; read?: number };
  },
): SessionMessage.WithParts {
  return {
    id,
    metadata: {
      createdAt: new Date(0),
      ...(aborted && {
        error: { kind: "aborted", message: "Aborted" },
        msToFinish: 900,
      }),
      sessionId: "ses_1",
      ...(usage && {
        usage: {
          inputTokenDetails: { cacheReadTokens: usage.read ?? 0 },
          inputTokens: usage.input,
          outputTokenDetails: {},
          outputTokens: usage.output,
          totalTokens: usage.input + usage.output,
        },
      }),
    },
    parts,
    role: "assistant",
  } as unknown as SessionMessage.WithParts;
}

function search(modelId: string, input: number, output: number) {
  return {
    metadata: { createdAt: new Date(0), id: "prt_s", messageId: "msg_s" },
    output: {
      results: {
        kind: "summary",
        modelId,
        sources: [],
        text: "",
        usage: { inputTokens: input, outputTokens: output },
      },
      state: "success",
    },
    state: "output-available",
    toolCallId: "call_s",
    type: "tool-web_search",
  };
}

describe("billedCostOf", () => {
  it.each([
    [
      "a key OpenRouter holds, which bills it all",
      { cost: 0.002, is_byok: false },
      0.002,
    ],
    [
      "a key the person brought, billed upstream",
      {
        cost: 0,
        cost_details: { upstream_inference_cost: 0.0098 },
        is_byok: true,
      },
      0.0098,
    ],
    [
      "a key the person brought, with OpenRouter's own fee on top",
      {
        cost: 0.0005,
        cost_details: { upstream_inference_cost: 0.01 },
        is_byok: true,
      },
      0.0105,
    ],
  ])("reads %s", (_, raw, dollars) => {
    expect(billedCostOf(raw)).toBeCloseTo(dollars, 10);
  });

  it.each([
    ["no raw usage", undefined],
    ["a provider that reports no cost", { prompt_tokens: 10 }],
  ])("says nothing for %s", (_, raw) => {
    expect(billedCostOf(raw)).toBeUndefined();
  });
});

describe("runCostOf", () => {
  it("takes the bill where a step reported one and the catalog elsewhere", () => {
    const cost = runCostOf(
      [
        step("msg_a", { usage: { input: 101_303, output: 331, read: 94_503 } }),
        step("msg_b", { usage: { input: 1_000_000, output: 0 } }),
      ],
      { billed: new Map([["msg_a", 0.0098]]), price: PRICE },
    );
    expect(cost).toMatchObject({
      billedSteps: 1,
      billedUSD: 0.0098,
      estimatedSteps: 1,
    });
    expect(cost.estimatedUSD).toBeCloseTo(0.1, 10);
    expect(costSourceOf(cost)).toBe("mixed");
    expect(modelCostUSD(cost)).toBeCloseTo(0.1098, 10);
  });

  it("counts a step stopped before its usage arrived, and prices nothing for it", () => {
    const cost = runCostOf([step("msg_a", { aborted: true })], {
      price: PRICE,
    });
    expect(cost.unmeteredSteps).toBe(1);
    expect(modelCostUSD(cost)).toBeUndefined();
    expect(describeCost(cost)).toMatchInlineSnapshot(
      `"1 stopped steps reported no usage"`,
    );
  });

  it("prices a search apart from the model's requests, at the search model's rate", () => {
    const cost = runCostOf(
      [
        step("msg_a", {
          parts: [search("anthropic/claude-haiku-5.5", 10_000, 1000)],
          usage: { input: 1000, output: 100 },
        }),
      ],
      {
        billed: new Map([["msg_a", 0.0002]]),
        price: PRICE,
        priceFor: (slug) =>
          slug === "anthropic/claude-haiku-5.5" ? PRICE : undefined,
      },
    );
    expect(cost.billedUSD).toBe(0.0002);
    expect(cost.search.searches).toBe(1);
    expect(cost.search.estimatedUSD).toBeCloseTo(0.0015, 10);
    expect(describeCost(cost)).toMatchInlineSnapshot(
      `"$0.0002 billed, searches ~$0.0015 (1)"`,
    );
  });

  it("leaves a step with neither a bill nor a price unpriced", () => {
    const cost = runCostOf(
      [step("msg_a", { usage: { input: 10, output: 1 } })],
      {},
    );
    expect(cost.unpricedSteps).toBe(1);
    expect(modelCostUSD(cost)).toBeUndefined();
  });
});

describe("capSpendOf", () => {
  it.each([
    {
      cost: { billedSteps: 2, billedUSD: 0.5, searches: 0, searchUSD: 0 },
      expected: { costUSD: 0.5, modelPriced: true },
      name: "the model's cost alone",
    },
    {
      cost: { billedSteps: 0, billedUSD: 0, searches: 3, searchUSD: 2.5 },
      expected: { costUSD: 2.5, modelPriced: false },
      name: "priced searches on a model with no price",
    },
    {
      cost: { billedSteps: 1, billedUSD: 0.5, searches: 1, searchUSD: 0.25 },
      expected: { costUSD: 0.75, modelPriced: true },
      name: "both together",
    },
    {
      cost: { billedSteps: 0, billedUSD: 0, searches: 0, searchUSD: 0 },
      expected: { costUSD: undefined, modelPriced: false },
      name: "nothing it could price",
    },
  ])("counts $name", ({ cost, expected }) => {
    const run = emptyRunCost();
    run.billedSteps = cost.billedSteps;
    run.billedUSD = cost.billedUSD;
    run.search.searches = cost.searches;
    run.search.estimatedUSD = cost.searchUSD;
    expect(capSpendOf(run)).toEqual(expected);
  });
});

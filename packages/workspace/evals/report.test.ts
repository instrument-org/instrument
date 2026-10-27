import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../src/schemas/session/message";
import { emptyRunCost } from "./lib/run-cost";
import { combineTrials, type RollupSummary, unfinishedCalls } from "./report";

/** One assistant message holding `parts`, as a session's history holds it. */
function message(parts: unknown[]): SessionMessage.WithParts {
  return {
    id: "msg_1",
    metadata: { createdAt: new Date(0), id: "msg_1", sessionId: "ses_1" },
    parts,
    role: "assistant",
  } as unknown as SessionMessage.WithParts;
}

const toolPart = (state: string) => ({
  input: {},
  metadata: { createdAt: new Date(0), id: `prt_${state}`, messageId: "msg_1" },
  state,
  toolCallId: "call_1",
  type: "tool-load_skill",
});

describe("unfinishedCalls", () => {
  it.each(["input-available", "input-streaming"])(
    "names a call left at %s",
    (state) => {
      expect(unfinishedCalls([message([toolPart(state)])])).toEqual([
        { messageId: "msg_1", state, type: "tool-load_skill" },
      ]);
    },
  );

  it.each(["output-available", "output-error"])(
    "says nothing of a call that reached %s",
    (state) => {
      expect(unfinishedCalls([message([toolPart(state)])])).toEqual([]);
    },
  );

  it("ignores everything that is not a call", () => {
    const text = {
      metadata: { createdAt: new Date(0), id: "prt_t", messageId: "msg_1" },
      state: "done",
      text: "hello",
      type: "text",
    };
    expect(unfinishedCalls([message([text])])).toEqual([]);
  });

  it("says nothing of a session with no messages", () => {
    expect(unfinishedCalls([])).toEqual([]);
  });
});

/** A trial's report holding one run of `caseName`. */
function trialReport(
  caseName: string,
  run: { costUSD?: number; passed: number; tokens: number },
): RollupSummary {
  return {
    assertions: {
      failed: 1 - run.passed,
      pass_rate: run.passed,
      passed: run.passed,
      total: 1,
    },
    cost: { ...emptyRunCost(), billedSteps: 1, billedUSD: run.costUSD ?? 0 },
    erroredTasks: 0,
    modelURIs: ["m"],
    provenance: { generatedAt: "", systemPromptSha256: ["abc"] },
    results: [
      {
        assertions: [],
        caseName,
        chatId: "c",
        cost: emptyRunCost(),
        costUSD: run.costUSD,
        erroredRequests: 0,
        failed: 1 - run.passed,
        label: `${caseName}/m`,
        modelURI: "m",
        outputDir: `${caseName}/m`,
        passed: run.passed,
        totalTokens: run.tokens,
        trial: 1,
      },
    ],
    stoppedTasks: 0,
    tasks: 1,
  };
}

describe("combineTrials", () => {
  const combined = combineTrials([
    {
      exitCode: 0,
      rollup: trialReport("a", { costUSD: 0.3, passed: 1, tokens: 300 }),
      trial: 1,
    },
    {
      exitCode: 1,
      rollup: trialReport("a", { costUSD: 0.1, passed: 0, tokens: 100 }),
      trial: 2,
    },
    {
      exitCode: 0,
      rollup: trialReport("a", { costUSD: 0.2, passed: 1, tokens: 200 }),
      trial: 3,
    },
    { exitCode: 1, trial: 4 },
  ]);

  it("keeps every trial's result, numbered and filed under its trial", () => {
    expect(
      combined.results.map(({ outputDir, trial }) => ({ outputDir, trial })),
    ).toEqual([
      { outputDir: "trial-1/a/m", trial: 1 },
      { outputDir: "trial-2/a/m", trial: 2 },
      { outputDir: "trial-3/a/m", trial: 3 },
    ]);
    expect(combined.trials.at(-1)).toEqual({
      exitCode: 1,
      reported: false,
      trial: 4,
    });
  });

  it("gives each case's spread across its trials", () => {
    expect(combined.spread).toEqual([
      {
        assertions: { passed: 2, total: 3 },
        caseName: "a",
        costUSD: { max: 0.3, median: 0.2, min: 0.1 },
        modelURI: "m",
        stopped: {},
        tokens: { max: 300, median: 200, min: 100 },
        trials: 3,
      },
    ]);
    expect(combined.assertions).toMatchObject({ passed: 2, total: 3 });
  });
});

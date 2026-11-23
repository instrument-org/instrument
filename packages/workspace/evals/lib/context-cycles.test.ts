import { describe, expect, it } from "vitest";

import { type Session } from "../../src/schemas/session";
import { contextCycles, type StepKind } from "./context-cycles";

/** A step: one assistant message with its prompt and the commands it ran. */
function step(id: string, prompt: number, commands: string[] = []) {
  return {
    id,
    metadata: {
      usage: {
        inputTokenDetails: { cacheReadTokens: prompt - 1000 },
        inputTokens: prompt,
        outputTokens: 100,
      },
    },
    parts: commands.map((command) => ({
      input: { command },
      output: { output: "ok" },
      state: "output-available",
      toolCallId: `${id}-${command}`,
      type: "tool-bash",
    })),
    role: "assistant",
  };
}

const classify = (commands: string[]): StepKind =>
  commands.some((command) => command.includes("fill"))
    ? "act"
    : commands.length > 0
      ? "read"
      : "other";

/**
 * Builds only the fields the measure reads; a whole stored session would be
 * describing storage rather than the measure.
 */
function session(messages: unknown[]) {
  return { messages } as unknown as Session.WithMessagesAndParts;
}

describe("context cycles", () => {
  it("measures a rollover's room and what came right after it", () => {
    const cut = step("m3", 84_000, ["agent-browser fill @e2 12"]);
    cut.parts.push({
      // @ts-expect-error a data part beside the tool part, as stored
      data: {
        droppedMessages: 3,
        retainedUserMessages: 1,
        summary: "## Goal\nfill the sheet",
        summaryUsage: { inputTokens: 90_000, outputTokens: 2_000 },
      },
      metadata: { messageId: "m3" },
      type: "data-contextRollover",
    });
    const cycles = contextCycles(
      session([
        { id: "u1", metadata: {}, parts: [], role: "user" },
        step("m1", 40_000, ["agent-browser snapshot"]),
        step("m2", 60_000, ["agent-browser fill @e1 4"]),
        cut,
        step("m4", 45_000, ["agent-browser snapshot"]),
        step("m5", 52_000, ["agent-browser snapshot"]),
        step("m6", 58_000, ["agent-browser fill @e2 12"]),
      ]),
      { classify },
    );
    expect(cycles.rollovers).toMatchObject([
      {
        afterStep: 2,
        // Cut right after a result, and that step carried across.
        droppedNewestToolResult: false,
        promptAfter: 45_000,
        promptAtCut: 90_000,
        readStepsBeforeAct: 2,
        reranLastCommand: true,
        room: 45_000,
      },
    ]);
    expect(cycles.totalInputTokens).toBe(
      40_000 + 60_000 + 84_000 + 45_000 + 52_000 + 58_000 + 90_000,
    );
  });

  it("prices every token of a request past the step at the higher rate", () => {
    const price = {
      cacheRead: 0,
      cacheWrite: 0,
      input: 1,
      output: 0,
      step: 100_000,
      stepMultiplier: 5,
    };
    const under = contextCycles(session([step("a", 100_000)]), {
      classify,
      price,
    });
    const over = contextCycles(session([step("a", 100_001)]), {
      classify,
      price,
    });
    // Only the uncached thousand is priced, at 1 per million or 5 past it.
    expect(under.estimatedUSD).toBeCloseTo(0.001);
    expect(over.estimatedUSD).toBeCloseTo(0.005_005, 5);
  });
});

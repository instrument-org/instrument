import { describe, expect, it } from "vitest";

import { type Session } from "../../src/schemas/session";
import { type TaskId } from "../../src/schemas/task-id";
import { CONTEXT_ROLLOVER_EVALS } from "./context-rollover";

const [rolloverCase] = CONTEXT_ROLLOVER_EVALS;
const keepsItsFormat = rolloverCase?.assertions?.[0];

/**
 * The assertion reads two fields off each message, so a fixture carrying those
 * is the whole of what it sees. Cast because building a complete
 * `Session.WithMessagesAndParts` would be describing storage rather than the
 * thing under test.
 */
function sessionsWithAnswers(...answers: string[]) {
  return [
    {
      messages: answers.map((text) => ({
        parts: [{ text, type: "text" }],
        role: "assistant",
      })),
    },
  ] as unknown as Session.WithMessagesAndParts[];
}

const check = (...answers: string[]) =>
  keepsItsFormat?.check({
    sessions: sessionsWithAnswers(...answers),
    taskId: "task" as TaskId,
  });

describe("context rollover: kept the format it chose", () => {
  const CHOSEN = "1. One\n2. Two\n3. Three";

  it("passes when the answer survives the rollover unchanged", async () => {
    expect((await check(CHOSEN, CHOSEN))?.passed).toBe(true);
  });

  // The recorded failure, verbatim from FP-1270: the numbering stayed and every
  // word the agent had chosen went with the turns the rollover dropped.
  it("fails when the numbering stays and the words go", async () => {
    const result = await check(CHOSEN, "1.\n2.\n3.");
    expect(result?.passed).toBe(false);
    expect(result?.evidence).toContain("0/3");
  });

  // The other recorded degradation: words replaced by the digits themselves.
  it("fails when the words are replaced by digits", async () => {
    expect((await check(CHOSEN, "1. 1\n2. 2\n3. 3"))?.passed).toBe(false);
  });

  // Measured: a model explained the format it had just chosen, and scoring the
  // whole answer marked a perfectly preserved format as lost.
  it("ignores prose the first answer added about its own format", async () => {
    const withTalk = `${CHOSEN}\n\nI'll use this exact format each time you ask.`;
    expect((await check(withTalk, CHOSEN))?.passed).toBe(true);
  });

  it("reports inconclusive rather than passing on an answer with nothing to carry", async () => {
    const result = await check("1, 2, 3", "1, 2, 3");
    expect(result?.passed).toBe(false);
    expect(result?.evidence).toContain("Inconclusive");
  });
});

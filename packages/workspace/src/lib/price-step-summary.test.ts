import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";

import { summarizeBeforePriceStep } from "./price-step-summary";

const usage = {
  inputTokens: { cacheRead: 80, cacheWrite: 5, noCache: 15, total: 100 },
  outputTokens: { reasoning: 0, text: 20, total: 20 },
};

/** Long enough to be taken as a summary of a window at its price step. */
const FOUND =
  "- Harlow quoted $0.071 a unit for 4,000 units, delivered.\n".repeat(20);

const SUMMARY = [
  "## Goal",
  "Plan the move.",
  "## Done and found",
  FOUND,
  "## Files",
  "(none)",
  "## Decisions",
  "(none)",
  "## Next",
  "Pick a date.",
].join("\n");

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

/** A model that answers with a tool call `calls` times, then writes `text`. */
function carryingOn(calls: number, text: string) {
  let asked = 0;
  return new MockLanguageModelV4({
    doGenerate: () => {
      asked += 1;
      return Promise.resolve(
        asked <= calls
          ? {
              content: [
                {
                  text: "I'll keep going on the returns question.",
                  type: "text" as const,
                },
                {
                  input: "{}",
                  toolCallId: `call-${String(asked)}`,
                  toolName: "bash",
                  type: "tool-call" as const,
                },
              ],
              finishReason: { raw: "tool_use", unified: "tool-calls" as const },
              usage,
              warnings: [],
            }
          : {
              content: [{ text, type: "text" as const }],
              finishReason: { raw: "stop", unified: "stop" as const },
              usage,
              warnings: [],
            },
      );
    },
  });
}

describe("summarizeBeforePriceStep", () => {
  it("keeps a summary the model finished as it wrote it", async () => {
    expect((await summarize(writing(` ${SUMMARY} `, "stop")))?.summary).toBe(
      SUMMARY,
    );
  });

  it("says when the length limit cut a summary off", async () => {
    const cut = `## Goal\nPlan the move.\n## Done and found\n${FOUND}`;
    expect((await summarize(writing(cut, "length")))?.summary).toBe(
      `${cut.trim()}\n\n[This summary was cut off at its length limit. The conversation's transcript has what it does not cover.]`,
    );
  });

  it("gives nothing for a cut-off answer that never started the summary", async () => {
    expect(await summarize(writing(FOUND, "length"))).toBeUndefined();
  });

  it("gives nothing for a model that wrote nothing", async () => {
    expect(await summarize(writing("  ", "stop"))).toBeUndefined();
  });

  // Measured on Haiku 5.5: the reply carried on with the task, and its one
  // line of narration was kept as the summary.
  it("asks again when the answer calls a tool, and counts both asks", async () => {
    const result = await summarize(carryingOn(1, SUMMARY));
    expect(result?.summary).toBe(SUMMARY);
    expect(result?.usage?.inputTokens).toBe(200);
  });

  it("gives nothing when the second answer calls a tool too", async () => {
    expect(await summarize(carryingOn(2, SUMMARY))).toBeUndefined();
  });

  // Measured on Haiku 5.5: the reply answered the user's last question and
  // offered to write "the conversation summary you asked for".
  it("gives nothing for an answer without the headings", async () => {
    expect(
      await summarize(writing("Harlow is cheapest, at $0.071.", "stop")),
    ).toBeUndefined();
  });

  // Measured on a beta chat on Haiku 5.5: two of 123 summaries were replies
  // to the user under 1,000 characters.
  it("asks again when the answer is too short to be a summary", async () => {
    const short = [
      "## Goal",
      "Fill in the sheet.",
      "## Done and found",
      "The sheet is filled in.",
      "## Files",
      "(none)",
      "## Decisions",
      "(none)",
      "## Next",
      "(none)",
    ].join("\n");
    let asked = 0;
    const shortThenWhole = new MockLanguageModelV4({
      doGenerate: () => {
        asked += 1;
        return Promise.resolve({
          content: [{ text: asked === 1 ? short : SUMMARY, type: "text" }],
          finishReason: { raw: "stop", unified: "stop" },
          usage,
          warnings: [],
        });
      },
    });
    expect((await summarize(shortThenWhole))?.summary).toBe(SUMMARY);
    expect(await summarize(writing(short, "stop"))).toBeUndefined();
  });
});

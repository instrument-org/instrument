import { isToolPart } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { buildFrames, type Frame } from "./frames";
import { scenarios } from "./scenarios";
import { batch, fail, maxSteps, prose, sameStep, user } from "./script";
import { activity, read } from "./tools";

/** Each frame as what it is, then the state of every part in order. */
function draw(frames: Frame[]): string {
  return frames
    .map((frame) => {
      const parts = frame.messages.flatMap((message) =>
        message.parts.map((part) => {
          if (!isToolPart(part)) {
            return part.type === "text" || part.type === "reasoning"
              ? `${part.type}:${part.state ?? "done"}`
              : part.type;
          }
          if (part.state !== "input-available") {
            return part.state.replace("output-", "");
          }
          return part.metadata.startedAt ? "running" : "queued";
        }),
      );
      const mark = `${frame.mark.kind}${frame.mark.phase === undefined ? "" : `:${frame.mark.phase}`}`;
      return `${mark.padEnd(20)} ${parts.join(" ")}`;
    })
    .join("\n");
}

/** Tool parts that have started and not finished, which the queue caps at one. */
function running(frame: Frame): number {
  return frame.messages
    .flatMap((message) => message.parts)
    .filter(
      (part) =>
        isToolPart(part) &&
        part.metadata.startedAt !== undefined &&
        part.metadata.endedAt === undefined,
    ).length;
}

describe("buildFrames", () => {
  it("walks one call through the states a real call passes through", () => {
    expect(
      draw(
        buildFrames([read({ explanation: "Reading it", filePath: "./a.csv" })]),
      ),
    ).toMatchInlineSnapshot(`
      "call:streaming       input-streaming
      call:running         running
      call:done            available
      turn:settled         available"
    `);
  });

  it("keeps a call in one row, so its states replace rather than stack", () => {
    const frames = buildFrames([
      read({ explanation: "Reading it", filePath: "./a.csv" }),
    ]);
    const ids = frames.map(
      (frame) => frame.messages.at(-1)?.parts.at(0)?.metadata.id,
    );

    expect(new Set(ids).size).toBe(1);
    for (const frame of frames) {
      expect(frame.messages.at(-1)?.parts).toHaveLength(1);
    }
  });

  it("lands every call of a batch before it runs any of them", () => {
    expect(
      draw(
        buildFrames([
          batch(
            read({ explanation: "Q1", filePath: "./q1.csv" }),
            read({ explanation: "Q2", filePath: "./q2.csv" }),
          ),
        ]),
      ),
    ).toMatchInlineSnapshot(`
      "call:queued          queued
      call:queued          queued queued
      call:running         running queued
      call:done            available queued
      call:running         available running
      call:done            available available
      turn:settled         available available"
    `);
  });

  it("gives each act its own step, and shares one inside sameStep", () => {
    const bare = buildFrames([
      activity("Reading each quarter"),
      read({ explanation: "Q1", filePath: "./q1.csv" }),
    ]);
    const shared = buildFrames([
      sameStep(
        activity("Reading each quarter"),
        read({ explanation: "Q1", filePath: "./q1.csv" }),
      ),
    ]);

    // A turn is one assistant message per step, which is the shape the
    // grouping rules have to hold a group together across.
    expect(bare.at(-1)?.messages).toHaveLength(2);
    expect(shared.at(-1)?.messages).toHaveLength(1);
  });

  it("streams prose and then marks it done", () => {
    expect(
      draw(buildFrames([prose("one two three four five six seven eight")])),
    ).toMatchInlineSnapshot(`
      "prose:streaming      text:streaming
      prose:streaming      text:streaming
      prose:streaming      text:streaming
      prose:done           text:done
      turn:settled         text:done"
    `);
  });

  it("ends with the agent stopped, whatever the script said last", () => {
    for (const scenario of scenarios) {
      expect(buildFrames(scenario.script).at(-1)?.isAgentRunning).toBe(false);
    }
  });

  // The runtime drains calls one at a time, so a scenario that showed two at
  // once would be exercising a state the transcript never actually has to draw.
  it("never has two calls running at once, in any scenario", () => {
    const busiest = scenarios.map((scenario) => ({
      most: Math.max(...buildFrames(scenario.script).map(running)),
      scenario: scenario.name,
    }));

    expect(busiest.filter((entry) => entry.most > 1)).toEqual([]);
  });

  it("builds every scenario, so a part can never precede its step", () => {
    for (const scenario of scenarios) {
      expect(buildFrames(scenario.script).length).toBeGreaterThan(0);
    }
  });

  it("opens on the user's message when the script does", () => {
    const frames = buildFrames([user("do the thing")]);

    expect(frames[0]?.mark).toEqual({ kind: "user" });
    expect(frames[0]?.messages).toHaveLength(1);
  });

  // The error is recorded on the step the request was made from, not as a part,
  // so a turn that said something before it broke has to keep both.
  it("puts an error on the step it happened in", () => {
    const [frame] = buildFrames([
      sameStep(
        prose("I'll start by"),
        fail({ kind: "unknown", message: "it broke" }),
      ),
    ]).slice(-1);
    const message = frame?.messages.at(-1);

    expect(message?.role === "assistant" && message.metadata.error).toEqual({
      kind: "unknown",
      message: "it broke",
    });
    expect(message?.parts).toHaveLength(1);
    expect(frame?.isAgentRunning).toBe(false);
  });

  // A transcript of a bad afternoon is several failed turns in a row, and every
  // one of them but the last has a live turn after it.
  it.each([
    ["an error", fail({ kind: "unknown", message: "it broke" })],
    ["the step cap", maxSteps(200)],
  ])("has the agent working again after %s, once asked again", (_what, act) => {
    const frames = buildFrames([user("go"), act, user("again")]);

    expect(frames.map((frame) => frame.isAgentRunning)).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });
});

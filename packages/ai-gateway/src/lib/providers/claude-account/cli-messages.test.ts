import { type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";

import {
  endTurnOnResults,
  historyFrameTaken,
  nextMessage,
} from "./cli-messages";

/** A process whose CLI reports `messages`, then exits. */
function source(messages: Partial<SDKMessage>[]) {
  const queue = [...messages];
  return {
    messages: {
      next: () => {
        const value = queue.shift();
        return Promise.resolve(
          value === undefined
            ? { done: true as const, value: undefined }
            : // Only the fields the reader looks at.
              { done: false as const, value: value as SDKMessage },
        );
      },
    },
    rateLimit: undefined,
    stderr: "the CLI's last words",
  };
}

describe("nextMessage", () => {
  it("keeps a usage report on the source and reads on past it", async () => {
    const reading = source([
      { rate_limit_info: { status: "allowed" }, type: "rate_limit_event" },
      { type: "user" },
    ]);
    await expect(nextMessage(reading)).resolves.toEqual({ type: "user" });
    expect(reading.rateLimit).toEqual({ status: "allowed" });
  });

  it("fails on a turn that ended in failure", async () => {
    await expect(
      nextMessage(
        source([
          {
            errors: ["out of turns"],
            is_error: true,
            subtype: "error_max_turns",
            type: "result",
          },
        ]),
      ),
    ).rejects.toThrow("out of turns");
  });

  it("fails with what the CLI said when it exits", async () => {
    await expect(nextMessage(source([]))).rejects.toThrow(
      /the CLI's last words/,
    );
  });
});

describe("historyFrameTaken", () => {
  it("returns on a result of no turns", async () => {
    await expect(
      historyFrameTaken(
        source([
          { is_error: false, num_turns: 0, subtype: "success", type: "result" },
        ]),
      ),
    ).resolves.toBeUndefined();
  });

  it("fails when the frame ran a turn", async () => {
    await expect(
      historyFrameTaken(
        source([
          { is_error: false, num_turns: 1, subtype: "success", type: "result" },
        ]),
      ),
    ).rejects.toThrow(/ran a turn on a frame of history/);
  });
});

describe("endTurnOnResults", () => {
  it("returns once the turn ends on the results", async () => {
    await expect(
      endTurnOnResults(
        source([
          { type: "user" },
          { is_error: false, subtype: "success", type: "result" },
        ]),
      ),
    ).resolves.toBeUndefined();
  });

  it("fails the step when the model is asked about the results first", async () => {
    await expect(
      endTurnOnResults(source([{ type: "user" }, { type: "stream_event" }])),
    ).rejects.toThrow(/before the message that came after them/);
  });
});

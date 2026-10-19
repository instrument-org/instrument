import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { outputLimitModelNote } from "./output-limit-model-text";
import { MAX_OUTPUT_LIMIT_REPLIES, outputLimitRun } from "./output-limit-run";
import { systemNoteBody } from "./system-note";

const sessionId = StoreId.newSessionId();
const createdAt = new Date("2026-10-16T12:00:00Z");

function user(): SessionMessage.WithParts {
  return {
    id: StoreId.newMessageId(),
    metadata: { createdAt, sessionId },
    parts: [],
    role: "user",
  };
}

function reply(
  finishReason: "length" | "stop" | "tool-calls",
  extra: { error?: boolean; synthetic?: boolean } = {},
): SessionMessage.WithParts {
  return {
    id: StoreId.newMessageId(),
    metadata: {
      createdAt,
      finishReason,
      modelId: "m",
      providerId: "p",
      sessionId,
      ...(extra.synthetic ? { synthetic: true } : {}),
      ...(extra.error
        ? { error: { kind: "aborted" as const, message: "Aborted" } }
        : {}),
    },
    parts: [],
    role: "assistant",
  };
}

describe("outputLimitRun", () => {
  it.each<[string, SessionMessage.WithParts[], number]>([
    ["a turn with nothing in it", [], 0],
    ["a reply that finished", [user(), reply("stop")], 0],
    ["one reply that ran out of room", [user(), reply("length")], 1],
    ["two in a row", [user(), reply("length"), reply("length")], 2],
    [
      "a reply that finished after one that ran out of room",
      [user(), reply("length"), reply("stop")],
      0,
    ],
    [
      "a failed step between two that ran out of room, which is the same reply retried",
      [
        user(),
        reply("length"),
        reply("length", { error: true }),
        reply("length"),
      ],
      2,
    ],
    [
      "the synthetic message that ends the run, which nothing wrote and so does not count",
      [user(), reply("length"), reply("length", { synthetic: true })],
      1,
    ],
    [
      "a run in an earlier turn, which the user's message closes off",
      [user(), reply("length"), user(), reply("stop")],
      0,
    ],
    [
      "a turn whose steps called tools before the room ran out",
      [user(), reply("tool-calls"), reply("length")],
      1,
    ],
  ])("%s", (_, messages, expected) => {
    expect(outputLimitRun(messages)).toBe(expected);
  });

  it("stops the turn at the bound and not before", () => {
    const run = [user(), reply("length"), reply("length")];
    expect(outputLimitRun(run.slice(0, 2))).toBeLessThan(
      MAX_OUTPUT_LIMIT_REPLIES,
    );
    expect(outputLimitRun(run)).toBe(MAX_OUTPUT_LIMIT_REPLIES);
  });
});

describe("outputLimitModelNote", () => {
  it("counts the replies, not the continuations", () => {
    expect(systemNoteBody(outputLimitModelNote({ continuations: 1 })))
      .toMatchInlineSnapshot(`
      "The previous run was cut off at the output limit 2 times in a row and stopped there, not because the task was finished. What was written is above. Pick up from where it stops, and write the rest in several short replies rather than one long one."
    `);
  });
});

import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { stepInFlightIn } from "./in-flight";

type Part = SessionMessage.WithParts["parts"][number];

interface PartIds {
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
}

const sessionId = StoreId.newSessionId();

const at = (seconds: number) => new Date(Date.UTC(2026, 8, 29, 18, 0, seconds));

const partMetadata = (ids: PartIds, createdAt: Date) => ({
  createdAt,
  id: StoreId.newPartId(),
  ...ids,
});

const bash =
  (
    createdAt: Date,
    state: "input-available" | "output-available",
    startedAt?: Date,
  ) =>
  (ids: PartIds): Part => {
    const base = {
      input: { command: "rg pnpm /mnt/Home", yieldMs: 30_000 },
      toolCallId: `call_${createdAt.getTime()}`,
      type: "tool-bash" as const,
    };
    return state === "input-available"
      ? {
          ...base,
          metadata: {
            ...partMetadata(ids, createdAt),
            ...(startedAt ? { startedAt } : {}),
          },
          state,
        }
      : {
          ...base,
          metadata: { ...partMetadata(ids, createdAt), endedAt: createdAt },
          output: {
            command: base.input.command,
            commands: [],
            durationMs: 1,
            exitCode: 0,
            omittedBytes: 0,
            output: "",
          },
          state,
        };
  };

const text =
  (words: string, createdAt: Date, type: "reasoning" | "text" = "text") =>
  (ids: PartIds): Part => ({
    metadata: partMetadata(ids, createdAt),
    state: "streaming",
    text: words,
    type,
  });

function step(
  createdAt: Date,
  parts: ((ids: PartIds) => Part)[],
  finishedAt?: Date,
): SessionMessage.WithParts {
  const messageId = StoreId.newMessageId();
  return {
    id: messageId,
    metadata: {
      createdAt,
      finishReason: finishedAt ? "tool-calls" : "unknown",
      ...(finishedAt ? { finishedAt } : {}),
      modelId: "glm-5.3-flash",
      providerId: "openai-compatible",
      sessionId,
    },
    parts: parts.map((part) => part({ messageId, sessionId })),
    role: "assistant",
  };
}

function user(createdAt: Date): SessionMessage.WithParts {
  const messageId = StoreId.newMessageId();
  return {
    id: messageId,
    metadata: { createdAt, sessionId },
    parts: [
      {
        metadata: partMetadata({ messageId, sessionId }, createdAt),
        text: "Find where pnpm keeps its store.",
        type: "text",
      },
    ],
    role: "user",
  };
}

describe("stepInFlightIn", () => {
  it("measures a step writing for minutes after its last tool call", () => {
    const messages = [
      user(at(0)),
      step(at(5), [bash(at(20), "output-available")], at(21)),
      step(at(22), [text("Searching pnpm source. ".repeat(720), at(25))]),
    ];
    expect(stepInFlightIn(messages, at(360))).toMatchInlineSnapshot(
      `"working 6m · last tool call 5m 40s ago · writing for 5m 35s: ~4.1K tokens, no tool call"`,
    );
  });

  it("names the tool a step is running and for how long", () => {
    const messages = [
      user(at(0)),
      step(at(5), [bash(at(10), "input-available", at(12))], at(11)),
    ];
    expect(stepInFlightIn(messages, at(132))).toMatchInlineSnapshot(
      `"working 2m 12s · running bash for 2m (still running)"`,
    );
  });

  it("calls a step that has only reasoned so far thinking", () => {
    const messages = [
      user(at(0)),
      step(at(1), [text("Let me consider.", at(2), "reasoning")]),
    ];
    expect(stepInFlightIn(messages, at(50))).toMatchInlineSnapshot(
      `"working 50s · no tool call this turn · thinking for 48s: ~4 tokens, no tool call"`,
    );
  });

  it("says a request that has written nothing is waiting on the model", () => {
    const messages = [user(at(0)), step(at(3), [])];
    expect(stepInFlightIn(messages, at(33))).toMatchInlineSnapshot(
      `"working 33s · no tool call this turn · waiting on the model for 30s"`,
    );
  });

  it("has nothing to say without a turn", () => {
    expect(stepInFlightIn([], at(0))).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { TaskIdSchema } from "../schemas/task-id";
import { systemNoteBody } from "./system-note";
import { opensTypedTurn, TURN_NOTE } from "./turn-note";

const sessionId = StoreId.newSessionId();
const createdAt = new Date("2026-10-07T12:00:00Z");

function message(
  role: "assistant" | "user",
  parts: ("text" | "tool" | "wake")[],
  extra: { error?: boolean; inherited?: boolean } = {},
): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  const meta = () => ({
    createdAt,
    id: StoreId.newPartId(),
    messageId: id,
    sessionId,
  });
  const built = parts.map((kind): SessionMessagePart.Type => {
    switch (kind) {
      case "text": {
        return { metadata: meta(), state: "done", text: "Hi.", type: "text" };
      }
      case "tool": {
        return {
          input: { command: "ls", explanation: "Listing", yieldMs: 1000 },
          metadata: { ...meta(), endedAt: createdAt },
          output: {
            command: "ls",
            commands: ["ls"],
            durationMs: 0,
            exitCode: 0,
            omittedBytes: 0,
            output: "",
          },
          state: "output-available",
          toolCallId: `call-${id}`,
          type: "tool-bash",
        };
      }
      case "wake": {
        return {
          data: {
            events: [
              {
                status: "done",
                taskId: TaskIdSchema.parse("lisbon-hotel"),
                title: "Lisbon hotel",
              },
            ],
          },
          metadata: meta(),
          type: "data-taskEvent",
        };
      }
    }
  });
  return role === "user"
    ? {
        id,
        metadata: {
          createdAt,
          sessionId,
          ...(extra.inherited ? { inherited: true } : {}),
        },
        parts: built,
        role,
      }
    : {
        id,
        metadata: {
          createdAt,
          finishReason: "stop",
          modelId: "m",
          providerId: "p",
          sessionId,
          ...(extra.error
            ? { error: { kind: "aborted" as const, message: "Aborted" } }
            : {}),
        },
        parts: built,
        role,
      };
}

describe("opensTypedTurn", () => {
  const asked = message("user", ["text"]);

  it.each<[string, SessionMessage.WithParts[], boolean]>([
    ["the first step of a turn the user typed", [asked], true],
    ["a later step", [asked, message("assistant", ["tool"])], false],
    [
      "the retry of a first step that failed",
      [asked, message("assistant", [], { error: true })],
      true,
    ],
    ["a turn a finished task started", [message("user", ["wake"])], false],
    [
      "a turn a fork inherited",
      [message("user", ["text"], { inherited: true })],
      false,
    ],
    ["a session with no message yet", [], false],
  ])("%s", (_, messages, expected) => {
    expect(opensTypedTurn(messages)).toBe(expected);
  });

  it("asks for one sentence, then quiet until the outcome", () => {
    expect(systemNoteBody(TURN_NOTE)).toMatchInlineSnapshot(
      `"Before using any tool, write one sentence to the user about what you'll do, then nothing more until the outcome. If no tool is needed, just answer."`,
    );
  });
});

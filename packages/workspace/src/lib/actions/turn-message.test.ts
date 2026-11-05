import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";
import { turnMessageOf } from "./turn-message";

const sessionId = StoreId.newSessionId();
const T = (minute: number) => new Date(2026, 10, 5, 14, minute);

/** A message the person sent at `minute`, with what went with it. */
function typed(
  minute: number,
  text: string,
  rows?: { count: number; kind: "folder" | "move"; minutes: number }[],
): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  const metadata = () => ({
    createdAt: T(minute),
    id: StoreId.newPartId(),
    messageId: id,
    sessionId,
  });
  return {
    id,
    metadata: { createdAt: T(minute), sessionId },
    parts: [
      { metadata: metadata(), text, type: "text" },
      ...(rows
        ? [
            {
              data: { rows },
              metadata: metadata(),
              type: "data-actions" as const,
            },
          ]
        : []),
    ],
    role: "user",
  };
}

/** The agent's reply at `minute`, running `command` first when given. */
function answered(minute: number, command?: string): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  const metadata = {
    createdAt: T(minute),
    id: StoreId.newPartId(),
    messageId: id,
    sessionId,
  };
  const parts: SessionMessagePart.Type[] = [];
  if (command) {
    parts.push({
      callProviderMetadata: undefined,
      input: { command, explanation: "Looking", yieldMs: 5000 },
      metadata: { ...metadata, endedAt: T(minute), toolName: "bash" },
      output: {
        command,
        commands: ["instrument"],
        durationMs: 0,
        exitCode: 0,
        omittedBytes: 0,
        output: "",
      },
      preliminary: false,
      providerExecuted: true,
      state: "output-available",
      toolCallId: StoreId.ToolCallSchema.parse("call_1"),
      type: "tool-bash",
    });
  }
  parts.push({ metadata, text: "Done.", type: "text" });
  return {
    id,
    metadata: {
      aiGatewayModel: undefined,
      createdAt: T(minute),
      finishReason: "stop",
      modelId: "seeded",
      providerId: "seeded",
      sessionId,
    },
    parts,
    role: "assistant",
  };
}

describe("turnMessageOf", () => {
  it("finds the message a turn answered, the note it carried and whether names were looked up", () => {
    const messages = [
      typed(10, "Earlier"),
      answered(11),
      typed(20, "Put those back where they were", [
        { count: 1, kind: "folder", minutes: 6 },
        { count: 3, kind: "move", minutes: 2 },
      ]),
      answered(21, "instrument activity --since 1h"),
      typed(30, "Thanks"),
    ];

    expect(turnMessageOf(messages, T(20).getTime() + 500)).toEqual({
      at: T(20),
      lookedUp: true,
      noteLines: [
        "6m ago · opened a folder in Files",
        "2m ago · moved 3 files",
      ],
      text: "Put those back where they were",
    });
    expect(turnMessageOf(messages, T(10).getTime() + 500)).toEqual({
      at: T(10),
      lookedUp: false,
      text: "Earlier",
    });
  });

  it("finds nothing before the first message", () => {
    expect(turnMessageOf([typed(10, "Hi")], T(9).getTime())).toBeUndefined();
  });
});

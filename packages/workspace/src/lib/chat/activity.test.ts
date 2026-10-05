import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { latestStepIn } from "./activity";

const sessionId = StoreId.newSessionId();

function assistant(
  ...calls: { input: Record<string, string>; streaming?: boolean }[]
): SessionMessage.WithParts {
  const messageId = StoreId.newMessageId();
  return {
    id: messageId,
    metadata: { createdAt: new Date(0), sessionId },
    parts: calls.map(({ input, streaming = false }, index) => ({
      // A call streaming in holds only what has arrived of its input.
      input: streaming ? input : { command: "ls", yieldMs: 30_000, ...input },
      metadata: {
        createdAt: new Date(0),
        id: StoreId.newPartId(),
        messageId,
        sessionId,
      },
      state: streaming ? "input-streaming" : "input-available",
      toolCallId: StoreId.ToolCallSchema.parse(`call-${index}`),
      type: "tool-bash",
    })),
    role: "assistant",
  } as SessionMessage.WithParts;
}

describe("latestStepIn", () => {
  it.each([
    [
      "the phase over the call's own label",
      [{ input: { activity: "Charting the numbers", explanation: "Running" } }],
      "Charting the numbers",
    ],
    [
      "the label when the call named no phase",
      [{ input: { explanation: "Listing the folder" } }],
      "Listing the folder",
    ],
    [
      "the call before while a new phase is still arriving",
      [
        { input: { activity: "Finding the notes" } },
        { input: { activity: "Writ" }, streaming: true },
      ],
      "Finding the notes",
    ],
    [
      "a new phase once the call has moved past it",
      [
        { input: { activity: "Finding the notes" } },
        {
          input: { activity: "Writing the brief", explanation: "Wri" },
          streaming: true,
        },
      ],
      "Writing the brief",
    ],
  ])("reads %s", (_case, calls, expected) => {
    expect(latestStepIn([assistant(...calls)])).toBe(expected);
  });
});

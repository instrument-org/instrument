import { describe, expect, it, vi } from "vitest";

import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { Store } from "../store";
import { taskStanding } from "./standing";

vi.mock(import("../session-store-storage"));

let counter = 0;
const freshTask = () =>
  createMockTaskConfig(
    TaskIdSchema.parse(`standing-${Date.now()}-${(counter += 1)}`),
  );

async function withSession(taskId: ReturnType<typeof freshTask>) {
  const sessionId = StoreId.newSessionId();
  await Store.saveSession(
    { createdAt: new Date(), id: sessionId, title: "task" },
    taskId,
  );
  return sessionId;
}

function assistant(
  sessionId: StoreId.Session,
  part: (ids: {
    messageId: StoreId.Message;
    sessionId: StoreId.Session;
  }) => SessionMessage.WithParts["parts"][number],
): SessionMessage.AssistantWithParts {
  const messageId = StoreId.newMessageId();
  return {
    id: messageId,
    metadata: {
      createdAt: new Date(),
      finishReason: "stop",
      modelId: "glm-5.3-flash",
      providerId: "openai-compatible",
      sessionId,
    },
    parts: [part({ messageId, sessionId })],
    role: "assistant",
  };
}

describe("taskStanding", () => {
  it("says what a finished task said, in one line", async () => {
    const taskId = freshTask();
    const sessionId = await withSession(taskId);
    await Store.saveMessageWithParts(
      assistant(sessionId, (ids) => ({
        metadata: { createdAt: new Date(), id: StoreId.newPartId(), ...ids },
        text: "Done: 52 posts, ads skipped.\nThe file is in your folder.",
        type: "text",
      })),
      taskId,
    );

    const standing = await taskStanding({ isRunning: false, taskId });

    expect(standing).toEqual({
      kind: "done",
      line: "Done: 52 posts, ads skipped.",
    });
  });

  it("says what a task is waiting for when its turn ended on an ask", async () => {
    const taskId = freshTask();
    const sessionId = await withSession(taskId);
    await Store.saveMessageWithParts(
      assistant(sessionId, (ids) => ({
        input: {},
        metadata: { createdAt: new Date(), id: StoreId.newPartId(), ...ids },
        state: "input-available",
        toolCallId: "call_1",
        type: "tool-connect_app",
      })),
      taskId,
    );

    const standing = await taskStanding({ isRunning: false, taskId });

    expect(standing).toEqual({
      kind: "waiting",
      line: "Waiting for you to sign in",
    });
  });

  it("says the step while it runs", async () => {
    const taskId = freshTask();
    await withSession(taskId);

    const standing = await taskStanding({ isRunning: true, taskId });

    expect(standing.kind).toBe("running");
    expect(standing.line).toBe("Working");
  });
});

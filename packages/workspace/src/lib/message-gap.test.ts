import { describe, expect, it, vi } from "vitest";

import { type SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfig } from "../test/helpers/mock-task-config";
import { detectMessageGap } from "./message-gap";
import { Store } from "./store";

vi.mock(import("./session-store-storage"));

const HOUR = 60 * 60 * 1000;

describe("detectMessageGap", () => {
  async function setup() {
    const taskId = createMockTaskConfig(TaskIdSchema.parse("mock"));
    const sessionId = StoreId.newSessionId();

    await Store.saveSession(
      { createdAt: new Date(0), id: sessionId, title: "Test session" },
      taskId,
    );

    /** A message the user typed. */
    async function typed(at: Date) {
      const messageId = StoreId.newMessageId();
      await Store.saveMessageWithParts(
        {
          id: messageId,
          metadata: { createdAt: at, sessionId },
          parts: [
            {
              metadata: {
                createdAt: at,
                id: StoreId.newPartId(),
                messageId,
                sessionId,
              },
              text: "Hello",
              type: "text",
            },
          ],
          role: "user",
        } satisfies SessionMessage.UserWithParts,
        taskId,
      );
    }

    /** A task finishing, which wakes the orchestrator on the same role. */
    async function wake(at: Date) {
      const messageId = StoreId.newMessageId();
      await Store.saveMessageWithParts(
        {
          id: messageId,
          metadata: { createdAt: at, sessionId },
          parts: [
            {
              data: { events: [] },
              metadata: {
                createdAt: at,
                id: StoreId.newPartId(),
                messageId,
                sessionId,
              },
              type: "data-taskEvent",
            },
          ],
          role: "user",
        } satisfies SessionMessage.UserWithParts,
        taskId,
      );
    }

    return {
      detect: (sentAt: Date) =>
        detectMessageGap({
          messageId: StoreId.newMessageId(),
          sentAt,
          sessionId,
          taskId,
        }),
      typed,
      wake,
    };
  }

  it("reports nothing on the first message of a channel", async () => {
    const { detect } = await setup();

    const result = await detect(new Date(9 * HOUR));

    expect(result._unsafeUnwrap()).toBeUndefined();
  });

  it("reports nothing while the user is still in the same sitting", async () => {
    const { detect, typed } = await setup();
    await typed(new Date(9 * HOUR));

    const result = await detect(new Date(9.5 * HOUR));

    expect(result._unsafeUnwrap()).toBeUndefined();
  });

  it("reports the gap once the user has been away", async () => {
    const { detect, typed } = await setup();
    await typed(new Date(9 * HOUR));

    const result = await detect(new Date(31 * HOUR));

    expect(result._unsafeUnwrap()).toMatchObject({
      data: { minutes: 22 * 60 },
      type: "data-messageGap",
    });
  });

  it("measures from the user, not from a task that woke it meanwhile", async () => {
    const { detect, typed, wake } = await setup();
    await typed(new Date(9 * HOUR));
    await wake(new Date(30 * HOUR));

    const result = await detect(new Date(31 * HOUR));

    expect(result._unsafeUnwrap()).toMatchObject({
      data: { minutes: 22 * 60 },
      type: "data-messageGap",
    });
  });
});

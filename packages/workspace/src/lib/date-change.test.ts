import { afterEach, describe, expect, it, vi } from "vitest";

import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfig } from "../test/helpers/mock-task-config";
import { detectDateChange } from "./date-change";
import { Store } from "./store";

vi.mock(import("./session-store-storage"));

/**
 * Local wall-clock, not an ISO instant: the correction is about the calendar
 * date the user is on, so a fixture written in UTC would land on a different
 * day for anyone far enough east or west and the test would pass or fail by
 * timezone.
 */
function localDate(year: number, month: number, day: number, hour: number) {
  return new Date(year, month - 1, day, hour);
}

function useClock(now: Date) {
  // Only Date: faking timers wholesale would stall the store's own promises.
  vi.useFakeTimers({ now, toFake: ["Date"] });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("detectDateChange", () => {
  async function setup({ baselineAt }: { baselineAt?: Date }) {
    const taskId = createMockTaskConfig(TaskIdSchema.parse("mock"));
    const sessionId = StoreId.newSessionId();

    await Store.saveSession(
      {
        createdAt: baselineAt ?? new Date(),
        id: sessionId,
        title: "Test session",
      },
      taskId,
    );

    if (baselineAt) {
      const messageId = StoreId.newMessageId();
      await Store.saveMessageWithParts(
        {
          id: messageId,
          metadata: {
            agentName: "main",
            createdAt: baselineAt,
            realRole: "system",
            sessionId,
          },
          parts: [
            {
              metadata: {
                createdAt: baselineAt,
                id: StoreId.newPartId(),
                messageId,
                sessionId,
              },
              state: "done",
              text: "System prompt",
              type: "text",
            },
          ],
          role: "session-context",
        } satisfies SessionMessage.ContextWithParts,
        taskId,
      );
    }

    return {
      detect: () =>
        detectDateChange({
          messageId: StoreId.newMessageId(),
          sessionId,
          taskId,
        }),
      record: async (part: SessionMessagePart.Type) => {
        const messageId = part.metadata.messageId;
        await Store.saveMessageWithParts(
          {
            id: messageId,
            metadata: { createdAt: new Date(), sessionId },
            parts: [part],
            role: "user",
          } satisfies SessionMessage.UserWithParts,
          taskId,
        );
      },
    };
  }

  it("reports nothing before the session has a baseline", async () => {
    useClock(localDate(2013, 9, 1, 9));
    const { detect } = await setup({});

    const result = await detect();

    expect(result._unsafeUnwrap()).toBeUndefined();
  });

  it("reports nothing on the day the baseline was written", async () => {
    useClock(localDate(2013, 8, 31, 12));
    const { detect } = await setup({ baselineAt: localDate(2013, 8, 31, 9) });

    const result = await detect();

    expect(result._unsafeUnwrap()).toBeUndefined();
  });

  it("reports the new date once the session crosses midnight", async () => {
    const { detect } = await setup({ baselineAt: localDate(2013, 8, 31, 23) });
    useClock(localDate(2013, 9, 1, 1));

    const result = await detect();

    expect(result._unsafeUnwrap()).toMatchObject({
      data: { date: "2013-09-01" },
      type: "data-dateChange",
    });
  });

  it("reports nothing again on a day already corrected", async () => {
    const { detect, record } = await setup({
      baselineAt: localDate(2013, 8, 31, 23),
    });
    useClock(localDate(2013, 9, 1, 1));

    const firstResult = await detect();
    const first = firstResult._unsafeUnwrap();
    if (!first) {
      throw new Error("Expected a correction on the first message of the day");
    }
    await record(first);
    const secondResult = await detect();

    expect(secondResult._unsafeUnwrap()).toBeUndefined();
  });
});

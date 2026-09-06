import { describe, expect, it, vi } from "vitest";

import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { Store } from "../store";
import { latestOrNewSessionId, latestSessionId } from "./latest-session";

vi.mock(import("../session-store-storage"));

describe("latestOrNewSessionId", () => {
  it("creates a session for a task that has none, and answers with it after", async () => {
    const taskId = createMockTaskConfig(TaskIdSchema.parse("fresh"));
    const before = await latestSessionId(taskId);
    expect(before._unsafeUnwrap()).toBeUndefined();

    const first = await latestOrNewSessionId(taskId);
    const again = await latestOrNewSessionId(taskId);

    expect(again._unsafeUnwrap()).toBe(first._unsafeUnwrap());
    const sessions = await Store.getSessions(taskId);
    expect(sessions._unsafeUnwrap().map((session) => session.id)).toEqual([
      first._unsafeUnwrap(),
    ]);
  });

  it("answers with the newest of several", async () => {
    const taskId = createMockTaskConfig(TaskIdSchema.parse("several"));
    const older = StoreId.newSessionId();
    const newer = StoreId.newSessionId();
    for (const id of [newer, older]) {
      await Store.saveSession(
        { createdAt: new Date(), id, title: `Session ${id}` },
        taskId,
      );
    }

    const latest = await latestOrNewSessionId(taskId);
    expect(latest._unsafeUnwrap()).toBe(newer);
  });
});

import { describe, expect, it } from "vitest";

import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { publisher } from "../publisher";
import { threadChanges } from "./orchestrator";

const taskId = TaskIdSchema.parse("orchestrator-changes");
const otherTaskId = TaskIdSchema.parse("orchestrator-other");

/** Whether the stream fires within a tick, so a silence can be asserted too. */
async function fired(
  pending: Promise<IteratorResult<null, void>>,
): Promise<boolean> {
  return Promise.race([
    pending.then(() => true),
    new Promise<boolean>((resolve) => {
      setTimeout(() => {
        resolve(false);
      }, 50);
    }),
  ]);
}

describe("threadChanges", () => {
  it("fires when the workspace's apps change, since a thread's holds name only the apps the workspace has", async () => {
    const controller = new AbortController();
    const changes = threadChanges(taskId, controller.signal);
    const next = changes.next();
    publisher.publish("app.updated", null);
    expect(await fired(next)).toBe(true);
    controller.abort();
    await changes.return();
  });

  it("stays quiet on another task's session", async () => {
    const controller = new AbortController();
    const changes = threadChanges(taskId, controller.signal);
    const next = changes.next();
    publisher.publish("session.updated", {
      id: otherTaskId,
      sessionId: StoreId.newSessionId(),
    });
    expect(await fired(next)).toBe(false);
    controller.abort();
    await changes.return();
  });
});

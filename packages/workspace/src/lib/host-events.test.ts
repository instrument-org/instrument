import { describe, expect, it } from "vitest";

import { publisher } from "../rpc/publisher";
import { StoreId } from "../schemas/store-id";
import { TaskIdSchema } from "../schemas/task-id";
import { appChanged } from "./apps/changed";
import { appListChanges, sessionEnds } from "./host-events";

describe("host events", () => {
  it("hands the host each session that ended", async () => {
    const controller = new AbortController();
    const ends = sessionEnds({ signal: controller.signal });
    const next = ends.next();
    const ended = {
      id: TaskIdSchema.parse("host-events"),
      sessionId: StoreId.newSessionId(),
    };
    publisher.publish("session.done", ended);
    expect((await next).value).toEqual(ended);
    controller.abort();
  });

  it("hands the host each change to the apps", async () => {
    const controller = new AbortController();
    const changes = appListChanges(controller.signal);
    const next = changes.next();
    await appChanged("drafts");
    expect((await next).done).toBe(false);
    controller.abort();
  });
});

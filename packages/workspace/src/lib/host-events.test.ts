import { describe, expect, it } from "vitest";

import { publisher } from "../rpc/publisher";
import { StoreId } from "../schemas/store-id";
import { ChatIdSchema } from "../schemas/chat-id";
import { appChanged } from "./apps/changed";
import { appListChanges, chatSettles } from "./host-events";

describe("host events", () => {
  it("hands the host each chat that settled", async () => {
    const controller = new AbortController();
    const settles = chatSettles({ signal: controller.signal });
    const next = settles.next();
    const settled = {
      id: ChatIdSchema.parse("host-events"),
      sessionId: StoreId.newSessionId(),
    };
    publisher.publish("chat.settled", settled);
    expect((await next).value).toEqual(settled);
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

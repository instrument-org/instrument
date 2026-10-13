import { describe, expect, it } from "vitest";

import { StoreId } from "../schemas/store-id";
import { ChatIdSchema } from "../schemas/chat-id";
import { publisher } from "./publisher";

describe("publisher", () => {
  it("keeps every event for a subscriber still busy with an earlier one", async () => {
    // What a chat's wake listener is while it handles one task's end: two
    // more tasks ending meanwhile must each still wake their chat.
    const controller = new AbortController();
    const ends = publisher.subscribe("session.done", {
      signal: controller.signal,
    });
    const ids = ["a", "b", "c"].map((name) => ({
      id: ChatIdSchema.parse(`task-${name}`),
      sessionId: StoreId.newSessionId(),
    }));

    for (const id of ids) {
      publisher.publish("session.done", id);
    }

    const heard = [];
    for (const _ of ids) {
      heard.push((await ends.next()).value);
    }
    expect(heard).toEqual(ids);
    controller.abort();
  });
});

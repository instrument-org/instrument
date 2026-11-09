import { describe, expect, it, vi } from "vitest";

/** The apps folder's watches: what each would call on an edit, and how many stopped. */
const watches = vi.hoisted(() => {
  const onChanges: (() => void)[] = [];
  return { onChanges, stopped: 0 };
});
vi.mock("./folder-watch", () => ({
  watchFolder: (_dir: string, { onChange }: { onChange: () => void }) => {
    watches.onChanges.push(onChange);
    return () => {
      watches.stopped += 1;
    };
  },
}));

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

  it("says one edit to the apps folder once, however many listen", () => {
    watches.onChanges.length = 0;
    watches.stopped = 0;
    const heard: null[] = [];
    const unsubscribe = publisher.subscribe("app.updated", (change) => {
      heard.push(change);
    });
    const first = new AbortController();
    const second = new AbortController();
    appListChanges(first.signal);
    appListChanges(second.signal);
    expect(watches.onChanges).toHaveLength(1);
    watches.onChanges[0]?.();
    expect(heard).toEqual([null]);
    first.abort();
    expect(watches.stopped).toBe(0);
    second.abort();
    expect(watches.stopped).toBe(1);
    unsubscribe();
  });
});

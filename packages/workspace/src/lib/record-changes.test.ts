import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { TASKS_DIR_NAME } from "../constants";
import { ChatIdSchema } from "../schemas/chat-id";
import { StoreId } from "../schemas/store-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { cacheByChatGeneration } from "./chat-generation";
import {
  recordChanged,
  recordChanges,
  recordMessageChanged,
  recordRemoved,
} from "./record-changes";
import { setChatState } from "./chat-record";
import { chatDir } from "./record-folders";

const one = ChatIdSchema.parse("record-changes-one");
const two = ChatIdSchema.parse("record-changes-two");

describe("recordChanges", () => {
  it("hands over a burst as one batch, each change once", async () => {
    const changes = recordChanges(undefined, { live: true });
    recordChanged(one, "messages");
    recordChanged(one, "messages");
    recordChanged(two, "agent");
    recordChanged(one, "session");
    const batch = await changes.next();
    expect(batch.value).toEqual([
      { id: one, kind: "messages" },
      { id: two, kind: "agent" },
      { id: one, kind: "session" },
    ]);
    await changes.return();
  });

  it("keeps what lands while the consumer is away for its next pull", async () => {
    const changes = recordChanges(undefined, { live: true });
    recordChanged(one, "messages");
    await changes.next();
    recordChanged(two, "settings");
    expect((await changes.next()).value).toEqual([
      { id: two, kind: "settings" },
    ]);
    await changes.return();
  });

  it("hands over only what it is asked to keep", async () => {
    const changes = recordChanges(undefined, {
      keep: (change) => change.id === two,
      live: true,
    });
    recordChanged(one, "messages");
    recordRemoved(two);
    expect((await changes.next()).value).toEqual([
      { id: two, kind: "removed" },
    ]);
    await changes.return();
  });

  it("leaves out changes to a running turn's memory unless asked for them", async () => {
    const written = recordChanges(undefined, { live: false });
    const streaming = recordChanges(undefined, { live: true });
    const message = {
      id: StoreId.newMessageId(),
      removed: false,
      sessionId: StoreId.newSessionId(),
    };
    recordMessageChanged(one, message, { live: true });
    recordChanged(two, "agent");
    expect((await written.next()).value).toEqual([{ id: two, kind: "agent" }]);
    expect((await streaming.next()).value).toEqual([
      { id: one, kind: "messages", live: true, message },
      { id: two, kind: "agent" },
    ]);
    await written.return();
    await streaming.return();
  });

  it("ends when its signal aborts", async () => {
    const controller = new AbortController();
    const changes = recordChanges(controller.signal, { live: true });
    const next = changes.next();
    controller.abort();
    expect(await next).toEqual({ done: true, value: undefined });
  });
});

describe("recordMessageChanged", () => {
  // The chat list's digest and a task's settled status are kept by the
  // chat's generation; a reply streaming in moves none of what they read.
  it("keeps what was derived from the session through a change in memory alone, not a written one", async () => {
    const sessionId = StoreId.newSessionId();
    const derived = cacheByChatGeneration<number>();
    let computed = 0;
    const read = () =>
      derived(one, sessionId, () => Promise.resolve((computed += 1)));
    const message = { id: StoreId.newMessageId(), removed: false, sessionId };

    expect(await read()).toBe(1);
    recordMessageChanged(one, message, { live: true });
    expect(await read()).toBe(1);
    recordMessageChanged(one, message);
    expect(await read()).toBe(2);
  });
});

describe("the record writer on the feed", () => {
  it("says a state write moved the state", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "record-changes-"));
    const chatId = createMockChatConfigForDir(
      path.join(root, TASKS_DIR_NAME, "record-changes-task"),
    );
    await fs.mkdir(chatDir(chatId), { recursive: true });
    const changes = recordChanges(undefined, {
      keep: (change) => change.id === chatId,
      live: true,
    });

    await setChatState(chatDir(chatId), { openedTabs: [] });
    expect((await changes.next()).value).toEqual([
      { id: chatId, kind: "state" },
    ]);

    await changes.return();
    await fs.rm(root, { force: true, recursive: true });
  });
});

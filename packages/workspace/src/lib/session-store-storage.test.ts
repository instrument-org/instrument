import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TASKS_DIR_NAME } from "../constants";
import { publisher } from "../rpc/publisher";
import { type ChatId, ChatIdSchema } from "../schemas/chat-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { sessionStorePath } from "./chat-dir-utils";
import {
  disposeSessionsStoreStorage,
  getSessionsStoreStorage,
  markStorageAsDisposing,
  unmarkStorageAsDisposing,
} from "./session-store-storage";
import { chatDir } from "./record-folders";

const id = ChatIdSchema.parse("session-store-storage-test");

let chatId: ChatId;
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "session-store-storage-"));
  chatId = createMockChatConfigForDir(path.join(root, TASKS_DIR_NAME, id));
  await fs.mkdir(chatDir(chatId), { recursive: true });
});

afterEach(async () => {
  unmarkStorageAsDisposing(chatId);
  await disposeSessionsStoreStorage(chatId);
  await fs.rm(root, { force: true, recursive: true });
  vi.restoreAllMocks();
});

async function storage() {
  return (await getSessionsStoreStorage(chatId))._unsafeUnwrap();
}

/** Counts every SQLite handle this process closes, whichever database it is. */
function closes() {
  return vi.spyOn(DatabaseSync.prototype, "close");
}

describe("session store storage", () => {
  it("says once what each write changed, and nothing for a read", async () => {
    const heard: string[] = [];
    const handle = await storage();
    const stop = publisher.subscribe("record.changed", (change) => {
      if (change.id === chatId) {
        heard.push(change.kind);
      }
    });
    await handle.setItemRaw("messages:session:message", "{}");
    await handle.setItemRaw("parts:session:message:part", "{}");
    await handle.setItemRaw("sessions:session", "{}");
    await handle.setItemRaw("browser-state:session", "{}");
    await handle.removeItem("parts:session:message:part");
    await handle.getItemRaw("sessions:session");
    await handle.getKeys("messages");
    stop();
    expect(heard).toEqual([
      "messages",
      "messages",
      "session",
      "session",
      "messages",
    ]);
  });

  it("writes a batch as one transaction a reader sees whole, and says what it changed", async () => {
    const handle = await storage();
    await handle.setItemRaw("parts:session:message:old", "{}");
    const heard: string[] = [];
    const stop = publisher.subscribe("record.changed", (change) => {
      if (change.id === chatId) {
        heard.push(change.kind);
      }
    });

    const written = handle.batch([
      { key: "messages:session:message", value: "message" },
      { key: "parts:session:message:new", value: "part" },
      { key: "parts:session:message:old", remove: true },
    ]);
    // Read while the batch is on its way: either before it or after it.
    const keysDuring = await handle.getKeys("parts:session:message");
    expect((await written).isOk()).toBe(true);
    stop();

    expect([
      ["parts:session:message:old"],
      ["parts:session:message:new"],
    ]).toContainEqual(keysDuring._unsafeUnwrap());
    expect(
      (await handle.getItemRaw("messages:session:message"))._unsafeUnwrap(),
    ).toBe("message");
    expect(
      (await handle.getKeys("parts:session:message"))._unsafeUnwrap(),
    ).toEqual(["parts:session:message:new"]);
    expect(heard).toEqual(["messages", "messages", "messages"]);
  });

  it("reads back what it wrote, across a dispose", async () => {
    const handle = await storage();
    expect((await handle.setItemRaw("key", "value")).isOk()).toBe(true);
    await disposeSessionsStoreStorage(chatId);

    const reopened = await storage();
    expect((await reopened.getItemRaw("key"))._unsafeUnwrap()).toBe("value");
  });

  it("lets a write already under way finish before the database closes", async () => {
    const handle = await storage();
    const write = handle.setItemRaw("key", "value");
    const disposed = disposeSessionsStoreStorage(chatId);

    expect((await write).isOk()).toBe(true);
    expect((await disposed).isOk()).toBe(true);
    const reopened = await storage();
    expect((await reopened.getItemRaw("key"))._unsafeUnwrap()).toBe("value");
  });

  it("refuses an operation that starts while the database is being closed", async () => {
    const handle = await storage();
    const disposed = disposeSessionsStoreStorage(chatId);
    const late = await handle.getItemRaw("key");
    await disposed;

    expect(late.isErr()).toBe(true);
  });

  it("does not let a store opened during a dispose outlive it", async () => {
    const handle = await storage();
    await disposeSessionsStoreStorage(chatId);
    // Nothing open now. A dispose and a reopen through the held handle start
    // together, as a cleanup and a late reader can.
    const disposed = disposeSessionsStoreStorage(chatId);
    const late = handle.getItemRaw("key");
    await disposed;

    expect((await late).isErr()).toBe(true);
  });

  it("refuses to open a store marked for deletion, and opens it again once unmarked", async () => {
    await storage();
    markStorageAsDisposing(chatId);
    await disposeSessionsStoreStorage(chatId);

    expect((await getSessionsStoreStorage(chatId)).isErr()).toBe(true);
    unmarkStorageAsDisposing(chatId);
    expect((await getSessionsStoreStorage(chatId)).isOk()).toBe(true);
  });

  it("closes the database a first read failed on, and reports why it failed", async () => {
    await fs.writeFile(
      sessionStorePath(chatDir(chatId)),
      "not a database, just bytes long enough to be read as a header",
    );
    const closed = closes();

    const opened = await getSessionsStoreStorage(chatId);

    expect(opened._unsafeUnwrapErr().message).toContain(
      "Failed to read session database",
    );
    expect(closed).toHaveBeenCalledTimes(1);
    // The dispose that comes before trashing such a chat has nothing left to
    // close, so the handle is closed once.
    expect((await disposeSessionsStoreStorage(chatId)).isOk()).toBe(true);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("keeps the database open once it opens, and closes it once on a dispose", async () => {
    const closed = closes();

    const handle = await storage();
    expect((await handle.setItemRaw("key", "value")).isOk()).toBe(true);
    expect(closed).not.toHaveBeenCalled();

    expect((await disposeSessionsStoreStorage(chatId)).isOk()).toBe(true);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("reopens through a handle held across a dispose", async () => {
    const handle = await storage();
    await handle.setItemRaw("key", "value");
    await disposeSessionsStoreStorage(chatId);

    expect((await handle.getItemRaw("key"))._unsafeUnwrap()).toBe("value");
  });
});

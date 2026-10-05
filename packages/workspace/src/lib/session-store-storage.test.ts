import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TASKS_DIR_NAME } from "../constants";
import { publisher } from "../rpc/publisher";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import {
  disposeSessionsStoreStorage,
  getSessionsStoreStorage,
  markStorageAsDisposing,
  unmarkStorageAsDisposing,
} from "./session-store-storage";
import { taskDir } from "./task-dir-utils";

const id = TaskIdSchema.parse("session-store-storage-test");

let taskId: TaskId;
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "session-store-storage-"));
  taskId = createMockTaskConfigForDir(path.join(root, TASKS_DIR_NAME, id));
  await fs.mkdir(taskDir(taskId), { recursive: true });
});

afterEach(async () => {
  unmarkStorageAsDisposing(taskId);
  await disposeSessionsStoreStorage(taskId);
  await fs.rm(root, { force: true, recursive: true });
});

async function storage() {
  return (await getSessionsStoreStorage(taskId))._unsafeUnwrap();
}

describe("session store storage", () => {
  it("says once what each write changed, and nothing for a read", async () => {
    const heard: string[] = [];
    const handle = await storage();
    const stop = publisher.subscribe("record.changed", (change) => {
      if (change.id === taskId) {
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

  it("reads back what it wrote, across a dispose", async () => {
    const handle = await storage();
    expect((await handle.setItemRaw("key", "value")).isOk()).toBe(true);
    await disposeSessionsStoreStorage(taskId);

    const reopened = await storage();
    expect((await reopened.getItemRaw("key"))._unsafeUnwrap()).toBe("value");
  });

  it("lets a write already under way finish before the database closes", async () => {
    const handle = await storage();
    const write = handle.setItemRaw("key", "value");
    const disposed = disposeSessionsStoreStorage(taskId);

    expect((await write).isOk()).toBe(true);
    expect((await disposed).isOk()).toBe(true);
    const reopened = await storage();
    expect((await reopened.getItemRaw("key"))._unsafeUnwrap()).toBe("value");
  });

  it("refuses an operation that starts while the database is being closed", async () => {
    const handle = await storage();
    const disposed = disposeSessionsStoreStorage(taskId);
    const late = await handle.getItemRaw("key");
    await disposed;

    expect(late.isErr()).toBe(true);
  });

  it("does not let a store opened during a dispose outlive it", async () => {
    const handle = await storage();
    await disposeSessionsStoreStorage(taskId);
    // Nothing open now. A dispose and a reopen through the held handle start
    // together, as a cleanup and a late reader can.
    const disposed = disposeSessionsStoreStorage(taskId);
    const late = handle.getItemRaw("key");
    await disposed;

    expect((await late).isErr()).toBe(true);
  });

  it("refuses to open a store marked for deletion, and opens it again once unmarked", async () => {
    await storage();
    markStorageAsDisposing(taskId);
    await disposeSessionsStoreStorage(taskId);

    expect((await getSessionsStoreStorage(taskId)).isErr()).toBe(true);
    unmarkStorageAsDisposing(taskId);
    expect((await getSessionsStoreStorage(taskId)).isOk()).toBe(true);
  });

  it("reopens through a handle held across a dispose", async () => {
    const handle = await storage();
    await handle.setItemRaw("key", "value");
    await disposeSessionsStoreStorage(taskId);

    expect((await handle.getItemRaw("key"))._unsafeUnwrap()).toBe("value");
  });
});

import { type Result } from "neverthrow";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import superjson from "superjson";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TASKS_DIR_NAME } from "../constants";
import { StoreId } from "../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import {
  disposeSessionsStoreStorage,
  getSessionsStoreStorage,
} from "./session-store-storage";
import { StorageKey } from "./storage-key";
import { Store } from "./store";
import { taskDir } from "./task-dir-utils";

const id = TaskIdSchema.parse("store-migrations-test");
const VERSION_KEY = "__migration_version__";

let taskId: TaskId;
let root: string;
let sessionId: StoreId.Session;
let messageId: StoreId.Message;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "store-migrations-test-"));
  taskId = createMockTaskConfigForDir(path.join(root, TASKS_DIR_NAME, id));
  await fs.mkdir(taskDir(taskId), { recursive: true });
  sessionId = StoreId.newSessionId();
  messageId = StoreId.newMessageId();
});

afterEach(async () => {
  await disposeSessionsStoreStorage(id);
  await fs.rm(root, { force: true, recursive: true });
});

function legacyFolderPart(folder: Record<string, unknown>) {
  return { data: { files: [], folders: [folder] }, type: "data-attachments" };
}

/** Opens the task, which migrates it, and reads back the stored part verbatim. */
async function openAndReadStoredPart(): Promise<
  Record<string, unknown> | undefined
> {
  const storage = unwrap(await getSessionsStoreStorage(taskId));
  const keys = unwrap(await storage.getKeys("parts"));
  const key = keys[0];
  if (key === undefined) {
    return undefined;
  }
  const stored = unwrap(await storage.getItemRaw<string>(key));
  return stored === null ? undefined : superjson.parse(stored);
}

/**
 * Writes a part the way an older build would have, then closes the database so
 * the next open sees a task that predates the migrations and runs them.
 */
async function seedStoredPart(part: Record<string, unknown>): Promise<void> {
  const storage = unwrap(await getSessionsStoreStorage(taskId));
  const partId = StoreId.newPartId();
  unwrap(
    await storage.setItemRaw(
      StorageKey.part(sessionId, messageId, partId),
      // Written the way the store writes, since that encoding is what a
      // migration has to read through.
      superjson.stringify({
        metadata: {
          createdAt: new Date(),
          id: partId,
          messageId,
          sessionId,
        },
        ...part,
      }),
    ),
  );
  // Opening the store to seed it earned a version row; drop it so the reopen
  // below has the version an older build would have left.
  unwrap(await storage.removeItem(VERSION_KEY));
  unwrap(await disposeSessionsStoreStorage(id));
}

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isErr()) {
    throw result.error instanceof Error
      ? result.error
      : new Error(String(result.error));
  }
  return result.value;
}

describe("store migrations", () => {
  it("renames a folder stored before the mount name said what it was", async () => {
    await seedStoredPart(
      legacyFolderPart({
        access: "read-write",
        createdAt: 1_718_198_400_000,
        id: "01KZ9NPNZZPQF80Z7A7DG4Z5BN",
        name: "Home-Downloads",
        path: "/Users/sam/Downloads",
        source: "user",
      }),
    );

    const parts = unwrap(await Store.getParts(sessionId, messageId, taskId));

    expect(parts[0]).toMatchObject({
      data: { folders: [{ mountName: "Home-Downloads" }] },
    });
  });

  // The point of migrating rather than translating on read: the stored data is
  // what changed, so nothing downstream has to know the old shape existed.
  it("writes the rename back to the database", async () => {
    await seedStoredPart(
      legacyFolderPart({
        name: "Home-Downloads",
        path: "/Users/sam/Downloads",
      }),
    );

    const stored = await openAndReadStoredPart();

    expect(stored?.data).toMatchObject({
      folders: [{ mountName: "Home-Downloads" }],
    });
    expect(JSON.stringify(stored)).not.toContain('"name"');
  });

  it("leaves a folder already carrying the current field alone", async () => {
    await seedStoredPart(
      legacyFolderPart({
        mountName: "Downloads",
        path: "/Users/sam/Downloads",
      }),
    );

    const stored = await openAndReadStoredPart();

    expect(stored?.data).toMatchObject({
      folders: [{ mountName: "Downloads" }],
    });
  });

  // A crash between the work and the version row re-runs the whole migration,
  // so running twice has to land where running once did.
  it("is unchanged by running a second time", async () => {
    await seedStoredPart(
      legacyFolderPart({
        name: "Home-Downloads",
        path: "/Users/sam/Downloads",
      }),
    );

    const afterFirst = await openAndReadStoredPart();
    const storage = unwrap(await getSessionsStoreStorage(taskId));
    unwrap(await storage.removeItem(VERSION_KEY));
    unwrap(await disposeSessionsStoreStorage(id));

    expect(await openAndReadStoredPart()).toEqual(afterFirst);
  });

  it("records the version so a migrated task does not scan again", async () => {
    await seedStoredPart({ text: "hello", type: "text" });

    const storage = unwrap(await getSessionsStoreStorage(taskId));

    expect(unwrap(await storage.getItemRaw<number>(VERSION_KEY))).toBe(1);
  });
});

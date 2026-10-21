import { type Result } from "neverthrow";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import superjson from "superjson";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StoreId } from "../schemas/store-id";
import { withChatDb } from "../test/helpers/chat-db";
import { StorageKey } from "./storage-key";
import { runStoreMigrations } from "./store-migrations";
import { type WrappedStorage } from "./wrap-storage";

const VERSION_KEY = "__migration_version__";

let file: string;
let root: string;
let sessionId: StoreId.Session;
let messageId: StoreId.Message;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "store-migrations-test-"));
  file = path.join(root, "chat.db");
  sessionId = StoreId.newSessionId();
  messageId = StoreId.newMessageId();
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

function legacyFolderPart(folder: Record<string, unknown>) {
  return { data: { files: [], folders: [folder] }, type: "data-attachments" };
}

/** Migrates the database and reads back the stored part verbatim. */
async function openAndReadStoredPart(): Promise<
  Record<string, unknown> | undefined
> {
  return withChatDb(file, async (storage) => {
    unwrap(await runStoreMigrations({ storage }));
    return readStoredPart(storage);
  });
}

async function readStoredPart(
  storage: WrappedStorage,
): Promise<Record<string, unknown> | undefined> {
  const keys = unwrap(await storage.getKeys("parts"));
  const key = keys[0];
  if (key === undefined) {
    return undefined;
  }
  const stored = unwrap(await storage.getItemRaw<string>(key));
  return stored === null ? undefined : superjson.parse(stored);
}

/**
 * Writes a part the way an older build would have, with no version row, so
 * the database predates the migrations and they run on it.
 */
async function seedStoredPart(part: Record<string, unknown>): Promise<void> {
  await withChatDb(file, async (storage) => {
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
  });
}

/** Migrates the database and reads back the version it records. */
function migratedVersion(): Promise<null | number> {
  return withChatDb(file, async (storage) => {
    unwrap(await runStoreMigrations({ storage }));
    return unwrap(await storage.getItemRaw<number>(VERSION_KEY));
  });
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
    await withChatDb(file, async (storage) => {
      unwrap(await storage.removeItem(VERSION_KEY));
    });

    expect(await openAndReadStoredPart()).toEqual(afterFirst);
  });

  // A database a newer build has migrated is ahead of us rather than behind:
  // writing this build's count over its marker would tell that build the task
  // is stale and make it run everything it knows again.
  it("leaves a version written by a newer build alone", async () => {
    await seedStoredPart({ text: "hello", type: "text" });
    await withChatDb(file, async (storage) => {
      unwrap(await storage.setItemRaw(VERSION_KEY, 3));
    });

    expect(await migratedVersion()).toBe(3);
  });

  it("records the version so a migrated task does not scan again", async () => {
    await seedStoredPart({ text: "hello", type: "text" });

    expect(await migratedVersion()).toBe(2);
  });
});

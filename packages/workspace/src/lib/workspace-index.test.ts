import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TASKS_DIR_NAME } from "../constants";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { chatDir } from "./record-folders";
import { ChatRecords, installChatRecords } from "./records/chat-records";
import { DEVICE_A, DEVICE_B } from "./records/test-records";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { closeWorkspaceDb } from "./workspace-db";
import { indexedByRecords, kept, unkept } from "./workspace-index";

const SESSION = StoreId.newSessionId();

let root: string;
let chatId: ChatId;
/** The workspace's database, outside the workspace as the app keeps it. */
let databaseFile: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-index-test-"));
  chatId = createMockChatConfigForDir(
    path.join(root, TASKS_DIR_NAME, "2026-10-01-indexed-task"),
  );
  databaseFile = path.join(root, "machine", "workspace.db");
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    workspaceDbFile: AbsolutePathSchema.parse(databaseFile),
  });
  await fs.mkdir(chatDir(chatId), { recursive: true });
  // A record on disk, which is what a row stands for.
  await fs.writeFile(
    path.join(chatDir(chatId), `${SESSION}.dev_AAAAAAAA.jsonl`),
    '{"t":"session","seq":1}\n',
  );
});

afterEach(async () => {
  closeWorkspaceDb();
  await fs.rm(root, { force: true, recursive: true });
});

/** Appends to the chat's log, which is what a row's stamp stands for. */
async function append() {
  const log = path.join(chatDir(chatId), `${SESSION}.dev_AAAAAAAA.jsonl`);
  const at = await fs.stat(log);
  await fs.appendFile(log, '{"t":"message","seq":2}\n');
  // A stamp is the file's size and modification time, and a test can append
  // inside one millisecond of writing it.
  await fs.utimes(log, at.atime, new Date(at.mtimeMs + 1000));
}

/** A fresh cache over the same index, as the next launch has: nothing in memory. */
function nextLaunch() {
  closeWorkspaceDb();
  return indexedByRecords<{ said: string }>("task_standings");
}

describe("indexedByRecords", () => {
  it("serves a value from the index on the next launch without deriving it", async () => {
    let derived = 0;
    const derive = () => {
      derived += 1;
      return Promise.resolve(kept({ said: "done" }));
    };

    expect(await nextLaunch()(chatId, SESSION, derive)).toEqual({
      said: "done",
    });
    expect(await nextLaunch()(chatId, SESSION, derive)).toEqual({
      said: "done",
    });
    expect(derived).toBe(1);
  });

  it("derives again once a record has been appended", async () => {
    let derived = 0;
    const derive = () => {
      derived += 1;
      return Promise.resolve(kept({ said: `read ${derived}` }));
    };
    await nextLaunch()(chatId, SESSION, derive);

    await append();

    expect(await nextLaunch()(chatId, SESSION, derive)).toEqual({
      said: "read 2",
    });
  });

  it("keeps its index when the workspace's folder moves", async () => {
    let derived = 0;
    const derive = () => {
      derived += 1;
      return Promise.resolve(kept({ said: "done" }));
    };
    await nextLaunch()(chatId, SESSION, derive);

    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      rootDir: WorkspaceDirSchema.parse(path.join(root, "moved")),
    });

    expect(await nextLaunch()(chatId, SESSION, derive)).toEqual({
      said: "done",
    });
    expect(derived).toBe(1);
  });

  it("starts over from an index of another version", async () => {
    let derived = 0;
    const derive = () => {
      derived += 1;
      return Promise.resolve(kept({ said: "done" }));
    };
    await nextLaunch()(chatId, SESSION, derive);
    closeWorkspaceDb();

    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(databaseFile);
    database.exec("UPDATE meta SET value = '0' WHERE key = 'workspace-index'");
    database.close();

    await nextLaunch()(chatId, SESSION, derive);
    expect(derived).toBe(2);
  });

  it("keeps nothing read around a failure, in memory or across launches", async () => {
    let derived = 0;
    const failing = () => {
      derived += 1;
      return Promise.resolve(unkept({ said: "unreadable" }));
    };
    const cache = nextLaunch();
    expect(await cache(chatId, SESSION, failing)).toEqual({
      said: "unreadable",
    });
    expect(await cache(chatId, SESSION, failing)).toEqual({
      said: "unreadable",
    });
    expect(derived).toBe(2);

    const read = await nextLaunch()(chatId, SESSION, () =>
      Promise.resolve(kept({ said: "read" })),
    );
    expect(read).toEqual({ said: "read" });
  });

  it("answers when it cannot save to an index another process has locked", async () => {
    let derived = 0;
    const derive = () => {
      derived += 1;
      return Promise.resolve(kept({ said: `read ${derived}` }));
    };
    await nextLaunch()(chatId, SESSION, derive);
    await append();
    closeWorkspaceDb();

    const { DatabaseSync } = await import("node:sqlite");
    const holder = new DatabaseSync(databaseFile);
    holder.exec("BEGIN EXCLUSIVE");
    try {
      expect(await nextLaunch()(chatId, SESSION, derive)).toEqual({
        said: "read 2",
      });
    } finally {
      holder.exec("ROLLBACK");
      holder.close();
    }
    // Nothing was saved, so the next launch derives it again.
    expect(await nextLaunch()(chatId, SESSION, derive)).toEqual({
      said: "read 3",
    });
  });

  it("rebuilds the index in a database SQLite cannot read, which is moved aside", async () => {
    await nextLaunch()(chatId, SESSION, () =>
      Promise.resolve(kept({ said: "first" })),
    );
    closeWorkspaceDb();
    for (const suffix of ["-wal", "-shm"]) {
      await fs.rm(`${databaseFile}${suffix}`, { force: true });
    }
    await fs.writeFile(databaseFile, "not a database, not even close to one");

    let derived = 0;
    const derive = () => {
      derived += 1;
      return Promise.resolve(kept({ said: "rebuilt" }));
    };
    expect(await nextLaunch()(chatId, SESSION, derive)).toEqual({
      said: "rebuilt",
    });
    expect(await nextLaunch()(chatId, SESSION, derive)).toEqual({
      said: "rebuilt",
    });
    expect(derived).toBe(1);
    const beside = await fs.readdir(path.dirname(databaseFile));
    expect(beside.filter((name) => name.includes(".unreadable-"))).toEqual([
      expect.stringMatching(/^workspace\.db\.unreadable-\d+$/),
    ]);
  });

  it("answers from a write still on its way rather than a row for the files without it", async () => {
    await nextLaunch()(chatId, SESSION, () =>
      Promise.resolve(kept({ said: "before" })),
    );
    const records = new ChatRecords({
      app: "0.0.0-test",
      device: DEVICE_A,
      dirOf: chatDir,
      fsync: false,
    });
    vi.spyOn(records, "isWriting").mockReturnValue(true);
    installChatRecords(records);
    try {
      expect(
        await nextLaunch()(chatId, SESSION, () =>
          Promise.resolve(kept({ said: "written" })),
        ),
      ).toEqual({ said: "written" });
    } finally {
      installChatRecords(undefined);
      await records.dispose();
    }
    // Nothing was saved over the row while the write was out.
    expect(
      await nextLaunch()(chatId, SESSION, () =>
        Promise.resolve(kept({ said: "derived" })),
      ),
    ).toEqual({ said: "before" });
  });

  it("keeps a value for what the chat held had read, not for a file it has yet to fold", async () => {
    await fs.rm(path.join(chatDir(chatId), `${SESSION}.dev_AAAAAAAA.jsonl`));
    const records = new ChatRecords({
      app: "0.0.0-test",
      device: DEVICE_A,
      dirOf: chatDir,
      fsync: false,
    });
    installChatRecords(records);
    try {
      await records.startSession(chatId, {
        createdAt: new Date(),
        id: SESSION,
      });
      // Another computer's records, synced in before this one folds them.
      await fs.writeFile(
        path.join(chatDir(chatId), `${SESSION}.${DEVICE_B}.jsonl`),
        '{"t":"message","seq":0}\n',
      );
      expect(
        await nextLaunch()(chatId, SESSION, () =>
          Promise.resolve(kept({ said: "without theirs" })),
        ),
      ).toEqual({ said: "without theirs" });
    } finally {
      installChatRecords(undefined);
      await records.dispose();
    }

    expect(
      await nextLaunch()(chatId, SESSION, () =>
        Promise.resolve(kept({ said: "with theirs" })),
      ),
    ).toEqual({ said: "with theirs" });
  });

  it("keeps its rows for another release", async () => {
    let derived = 0;
    const derive = () => {
      derived += 1;
      return Promise.resolve(kept({ said: "done" }));
    };
    await nextLaunch()(chatId, SESSION, derive);
    setWorkspaceConfig({ ...getWorkspaceConfig(), appVersion: "99.0.0" });
    await nextLaunch()(chatId, SESSION, derive);
    expect(derived).toBe(1);
  });
});

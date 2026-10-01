import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TASKS_DIR_NAME } from "../constants";
import { AbsolutePathSchema } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import {
  disposeSessionsStoreStorage,
  getSessionsStoreStorage,
} from "./session-store-storage";
import { taskDir } from "./task-dir-utils";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import {
  closeWorkspaceIndex,
  indexedByStore,
  kept,
  unkept,
} from "./workspace-index";

let root: string;
let taskId: TaskId;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-index-test-"));
  taskId = createMockTaskConfigForDir(
    path.join(root, TASKS_DIR_NAME, "2026-10-01-indexed-task"),
  );
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    indexesDir: AbsolutePathSchema.parse(path.join(root, "indexes")),
  });
  await fs.mkdir(taskDir(taskId), { recursive: true });
  // A store on disk, which is what a row stands for.
  const opened = await getSessionsStoreStorage(taskId);
  opened._unsafeUnwrap();
});

afterEach(async () => {
  closeWorkspaceIndex();
  await disposeSessionsStoreStorage(taskId);
  await fs.rm(root, { force: true, recursive: true });
});

/** A fresh cache over the same index, as the next launch has: nothing in memory. */
function nextLaunch() {
  closeWorkspaceIndex();
  return indexedByStore<{ said: string }>("task_standings");
}

describe("indexedByStore", () => {
  it("serves a value from the index on the next launch without deriving it", async () => {
    let derived = 0;
    const derive = () => {
      derived += 1;
      return Promise.resolve(kept({ said: "done" }));
    };

    expect(await nextLaunch()(taskId, derive)).toEqual({ said: "done" });
    expect(await nextLaunch()(taskId, derive)).toEqual({ said: "done" });
    expect(derived).toBe(1);
  });

  it("derives again once the store has been written", async () => {
    let derived = 0;
    const derive = () => {
      derived += 1;
      return Promise.resolve(kept({ said: `read ${derived}` }));
    };
    await nextLaunch()(taskId, derive);

    const opened = await getSessionsStoreStorage(taskId);
    const written = await opened._unsafeUnwrap().setItemRaw("note", "changed");
    written._unsafeUnwrap();

    expect(await nextLaunch()(taskId, derive)).toEqual({ said: "read 2" });
  });

  it("starts over from an index of another version", async () => {
    let derived = 0;
    const derive = () => {
      derived += 1;
      return Promise.resolve(kept({ said: "done" }));
    };
    await nextLaunch()(taskId, derive);
    closeWorkspaceIndex();

    const [file] = await fs.readdir(path.join(root, "indexes"));
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(path.join(root, "indexes", file ?? ""));
    database.exec("UPDATE meta SET value = '0' WHERE key = 'version'");
    database.close();

    await nextLaunch()(taskId, derive);
    expect(derived).toBe(2);
  });

  it("keeps nothing read around a failure, in memory or across launches", async () => {
    let derived = 0;
    const failing = () => {
      derived += 1;
      return Promise.resolve(unkept({ said: "unreadable" }));
    };
    const cache = nextLaunch();
    expect(await cache(taskId, failing)).toEqual({ said: "unreadable" });
    expect(await cache(taskId, failing)).toEqual({ said: "unreadable" });
    expect(derived).toBe(2);

    const read = await nextLaunch()(taskId, () =>
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
    await nextLaunch()(taskId, derive);
    const opened = await getSessionsStoreStorage(taskId);
    const written = await opened._unsafeUnwrap().setItemRaw("note", "changed");
    written._unsafeUnwrap();
    closeWorkspaceIndex();

    const [file] = await fs.readdir(path.join(root, "indexes"));
    const { DatabaseSync } = await import("node:sqlite");
    const holder = new DatabaseSync(path.join(root, "indexes", file ?? ""));
    holder.exec("BEGIN EXCLUSIVE");
    try {
      expect(await nextLaunch()(taskId, derive)).toEqual({ said: "read 2" });
    } finally {
      holder.exec("ROLLBACK");
      holder.close();
    }
    // Nothing was saved, so the next launch derives it again.
    expect(await nextLaunch()(taskId, derive)).toEqual({ said: "read 3" });
  });

  it("rebuilds an index file SQLite cannot read", async () => {
    await nextLaunch()(taskId, () => Promise.resolve(kept({ said: "first" })));
    closeWorkspaceIndex();
    const [file] = await fs.readdir(path.join(root, "indexes"));
    const indexFile = path.join(root, "indexes", file ?? "");
    for (const suffix of ["-wal", "-shm"]) {
      await fs.rm(`${indexFile}${suffix}`, { force: true });
    }
    await fs.writeFile(indexFile, "not a database, not even close to one");

    let derived = 0;
    const derive = () => {
      derived += 1;
      return Promise.resolve(kept({ said: "rebuilt" }));
    };
    expect(await nextLaunch()(taskId, derive)).toEqual({ said: "rebuilt" });
    expect(await nextLaunch()(taskId, derive)).toEqual({ said: "rebuilt" });
    expect(derived).toBe(1);
  });

  it("starts over for another release", async () => {
    let derived = 0;
    const derive = () => {
      derived += 1;
      return Promise.resolve(kept({ said: "done" }));
    };
    await nextLaunch()(taskId, derive);
    setWorkspaceConfig({ ...getWorkspaceConfig(), appVersion: "99.0.0" });
    await nextLaunch()(taskId, derive);
    expect(derived).toBe(2);
  });
});

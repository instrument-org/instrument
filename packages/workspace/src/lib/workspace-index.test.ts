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
import { closeWorkspaceIndex, indexedByStore } from "./workspace-index";

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
      return Promise.resolve({ said: "done" });
    };

    expect(await nextLaunch()(taskId, derive)).toEqual({ said: "done" });
    expect(await nextLaunch()(taskId, derive)).toEqual({ said: "done" });
    expect(derived).toBe(1);
  });

  it("derives again once the store has been written", async () => {
    let derived = 0;
    const derive = () => {
      derived += 1;
      return Promise.resolve({ said: `read ${derived}` });
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
      return Promise.resolve({ said: "done" });
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
});

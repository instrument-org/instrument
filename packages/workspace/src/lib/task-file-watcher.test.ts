import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { TASKS_DIR_NAME } from "../constants";
import { AbsolutePathSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfig } from "../test/helpers/mock-task-config";
import { type WorkspaceConfig } from "../types";
import {
  beginTurnChangeTracking,
  consumeTurnChanges,
  getCurrentTaskFiles,
  stopAllTaskFileWatchers,
} from "./task-file-watcher";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

const id = TaskIdSchema.parse("watcher-test");

let root: string;
let dir: string;
let workspaceConfig: WorkspaceConfig;

async function setupTask() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "watcher-test-"));
  const tasksDir = path.join(root, TASKS_DIR_NAME);
  dir = path.join(tasksDir, id);
  await fs.mkdir(path.join(dir, "sub"), { recursive: true });
  // createMockTaskConfig publishes the singleton; point it at the temp dir so
  // the watcher resolves dir under it.
  createMockTaskConfig(id);
  workspaceConfig = {
    ...getWorkspaceConfig(),
    tasksDir: AbsolutePathSchema.parse(tasksDir),
  };
  setWorkspaceConfig(workspaceConfig);
}

function trackedPaths() {
  return (getCurrentTaskFiles(id) ?? []).map((file) => String(file.filePath));
}

afterEach(async () => {
  // Release any lingering watcher so it doesn't outlive the test.
  await consumeTurnChanges({ id, sessionId: StoreId.newSessionId() });
  await fs.rm(root, { force: true, recursive: true });
});

describe("task file watcher turn tracking", () => {
  it("classifies added, modified, and deleted files across a turn", async () => {
    await setupTask();
    await fs.writeFile(path.join(dir, "a.txt"), "a");
    await fs.writeFile(path.join(dir, "sub", "b.txt"), "b");

    const sessionId = StoreId.newSessionId();
    await beginTurnChangeTracking({ id, sessionId, workspaceConfig });

    expect(trackedPaths()).toEqual(["a.txt", "sub/b.txt"]);

    await fs.writeFile(path.join(dir, "a.txt"), "aaaa");
    await fs.writeFile(path.join(dir, "c.txt"), "c");
    await fs.rm(path.join(dir, "sub", "b.txt"));

    const { changes } = await consumeTurnChanges({ id, sessionId });
    expect(
      changes.map(({ filePath, status }) => ({
        filePath: String(filePath),
        status,
      })),
    ).toEqual([
      { filePath: "a.txt", status: "modified" },
      { filePath: "c.txt", status: "added" },
      { filePath: "sub/b.txt", status: "deleted" },
    ]);

    // The turn held the only watcher ref, so consuming disposes it.
    expect(getCurrentTaskFiles(id)).toBeUndefined();
  }, 15_000);

  it("reports no changes for a turn that touches nothing", async () => {
    await setupTask();
    await fs.writeFile(path.join(dir, "a.txt"), "a");

    const sessionId = StoreId.newSessionId();
    await beginTurnChangeTracking({ id, sessionId, workspaceConfig });

    const { changes } = await consumeTurnChanges({ id, sessionId });
    expect(changes).toEqual([]);
    expect(getCurrentTaskFiles(id)).toBeUndefined();
  }, 15_000);

  it("ignores files created and deleted within the same turn", async () => {
    await setupTask();
    await fs.writeFile(path.join(dir, "a.txt"), "a");

    const sessionId = StoreId.newSessionId();
    await beginTurnChangeTracking({ id, sessionId, workspaceConfig });

    const ephemeral = path.join(dir, "ephemeral.txt");
    await fs.writeFile(ephemeral, "x");
    await fs.rm(ephemeral);

    const { changes } = await consumeTurnChanges({ id, sessionId });
    expect(changes).toEqual([]);
  }, 15_000);
});

describe("stopAllTaskFileWatchers", () => {
  it("disposes watchers still held by an in-flight turn", async () => {
    await setupTask();
    await fs.writeFile(path.join(dir, "a.txt"), "a");

    const sessionId = StoreId.newSessionId();
    await beginTurnChangeTracking({ id, sessionId, workspaceConfig });
    expect(getCurrentTaskFiles(id)).toBeDefined();

    await stopAllTaskFileWatchers();

    // The watcher (and its native subscription) is gone even though the turn
    // never released its ref -- the case that aborts the process on quit.
    expect(getCurrentTaskFiles(id)).toBeUndefined();

    // Consuming the now-orphaned turn is a safe no-op.
    const { changes } = await consumeTurnChanges({ id, sessionId });
    expect(changes).toEqual([]);
  }, 15_000);
});

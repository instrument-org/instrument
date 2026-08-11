import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TASKS_DIR_NAME } from "../constants";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { getTaskPrivateDir, taskDir } from "./task-dir-utils";
import { readTaskRecord, updateTaskRecord } from "./task-record";

const id = TaskIdSchema.parse("task-record-test");

let taskId: TaskId;
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "task-record-test-"));
  const tasksDir = path.join(root, TASKS_DIR_NAME);
  taskId = createMockTaskConfigForDir(path.join(tasksDir, id));
  await fs.mkdir(taskDir(taskId), { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

function recordPath(): string {
  return path.join(getTaskPrivateDir(taskDir(taskId)), "settings.json");
}

async function writeRecordFile(record: unknown): Promise<void> {
  await fs.mkdir(getTaskPrivateDir(taskDir(taskId)), { recursive: true });
  await fs.writeFile(recordPath(), JSON.stringify(record, null, 2), "utf8");
}

describe("readTaskRecord", () => {
  it("answers empty for a task with no file", async () => {
    const record = await readTaskRecord(taskDir(taskId));

    expect(record.settings).toBeUndefined();
    expect(record.state).toEqual({});
    expect(record.raw).toEqual({});
  });

  // The whole reason the two views are parsed apart. A draft or a pane the
  // schema rejects must not cost the task its title and its place in the list.
  it("keeps the settings when the state cannot be read", async () => {
    await writeRecordFile({
      name: "Still named",
      pinnedAt: "2026-01-01T00:00:00.000Z",
      state: { attachedFolders: "not a record at all" },
    });

    const record = await readTaskRecord(taskDir(taskId));

    expect(record.settings?.name).toBe("Still named");
    expect(record.state).toEqual({});
  });

  // And the other direction: a title this build cannot read must not silently
  // unmount the folders the agent is allowed to reach.
  it("keeps the state when the settings cannot be read", async () => {
    await writeRecordFile({
      name: { not: "a string" },
      state: { promptDraft: "half a sentence" },
    });

    const record = await readTaskRecord(taskDir(taskId));

    expect(record.settings).toBeUndefined();
    expect(record.state.promptDraft).toBe("half a sentence");
  });

  it("answers empty for a file that is not JSON, rather than throwing", async () => {
    await fs.mkdir(getTaskPrivateDir(taskDir(taskId)), { recursive: true });
    await fs.writeFile(recordPath(), "{ truncated mid-wr", "utf8");

    await expect(readTaskRecord(taskDir(taskId))).resolves.toMatchObject({
      settings: undefined,
    });
  });
});

describe("updateTaskRecord", () => {
  it("carries forward a field it cannot read rather than dropping it", async () => {
    await writeRecordFile({
      futureField: { written: "by a newer build" },
      name: "Test task",
    });

    await updateTaskRecord(taskDir(taskId), (record) => ({
      ...record.raw,
      name: "Renamed",
    }));

    const written: unknown = JSON.parse(
      await fs.readFile(recordPath(), "utf8"),
    );

    expect(written).toEqual({
      futureField: { written: "by a newer build" },
      name: "Renamed",
    });
  });

  it("leaves no temporary file behind", async () => {
    await updateTaskRecord(taskDir(taskId), () => ({ name: "Test task" }));

    const entries = await fs.readdir(getTaskPrivateDir(taskDir(taskId)));

    expect(entries).toEqual(["settings.json"]);
  });

  // The file is replaced by a rename, so a reader either sees the whole old one
  // or the whole new one. Nothing observes a half-written record.
  it("never leaves the file partially written", async () => {
    await writeRecordFile({ name: "Test task" });

    const long = "x".repeat(200_000);
    const reads: Promise<string>[] = [];

    const write = updateTaskRecord(taskDir(taskId), (record) => ({
      ...record.raw,
      state: { promptDraft: long },
    }));
    for (let index = 0; index < 20; index++) {
      reads.push(fs.readFile(recordPath(), "utf8"));
    }

    await write;
    const contents = await Promise.all(reads);

    for (const content of contents) {
      expect(() => JSON.parse(content) as unknown).not.toThrow();
    }
  });

  it("serializes overlapping updates instead of losing one", async () => {
    await Promise.all([
      updateTaskRecord(taskDir(taskId), (record) => ({
        ...record.raw,
        name: "Named",
      })),
      updateTaskRecord(taskDir(taskId), (record) => ({
        ...record.raw,
        state: { promptDraft: "drafted" },
      })),
    ]);

    const record = await readTaskRecord(taskDir(taskId));

    expect(record.settings?.name).toBe("Named");
    expect(record.state.promptDraft).toBe("drafted");
  });
});

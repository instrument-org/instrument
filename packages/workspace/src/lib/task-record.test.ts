import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TASKS_DIR_NAME } from "../constants";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { TaskPane } from "../schemas/task-pane";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { getTaskPrivateDir, taskDir } from "./task-dir-utils";
import {
  readTaskRecord,
  setTaskState,
  updateTaskPane,
  updateTaskRecord,
} from "./task-record";

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

  it("reports a task with no file as readable, since a write may create it", async () => {
    const record = await readTaskRecord(taskDir(taskId));

    expect(record.unreadable).toBe(false);
  });

  it.each([
    ["truncated JSON", "{ truncated mid-wr"],
    ["JSON that is not an object", "[1, 2, 3]"],
  ])("reports %s as unreadable", async (_name, contents) => {
    await fs.mkdir(getTaskPrivateDir(taskDir(taskId)), { recursive: true });
    await fs.writeFile(recordPath(), contents, "utf8");

    const record = await readTaskRecord(taskDir(taskId));

    expect(record.unreadable).toBe(true);
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

  // The half that matters for this: the top level is a closed set, `state` is
  // the one that keeps growing, so it is the one a build rollback meets.
  it("carries forward an unreadable field inside the state too", async () => {
    await writeRecordFile({
      name: "Test task",
      state: { futureNested: "keep me", promptDraft: "before" },
    });

    await setTaskState(taskDir(taskId), { promptDraft: "after" });

    const written: unknown = JSON.parse(
      await fs.readFile(recordPath(), "utf8"),
    );

    expect(written).toEqual({
      name: "Test task",
      state: { futureNested: "keep me", promptDraft: "after" },
    });
  });

  it("carries an unreadable state field through a pane change", async () => {
    await writeRecordFile({
      name: "Test task",
      state: { futureNested: "keep me" },
    });

    await updateTaskPane(taskDir(taskId), (pane) =>
      TaskPane.openTabs(pane, [TaskPane.fileTab("output/report.pdf")]),
    );

    const written: unknown = JSON.parse(
      await fs.readFile(recordPath(), "utf8"),
    );

    expect(written).toMatchObject({
      state: { futureNested: "keep me" },
    });
  });

  // What the empty answer to a failed read costs if a write is allowed to build
  // on it: the record read as though the task had nothing, so the write would
  // have been the title, the pin and the tabs replaced by one draft.
  it("refuses to replace a record it could not read", async () => {
    await fs.mkdir(getTaskPrivateDir(taskDir(taskId)), { recursive: true });
    await fs.writeFile(recordPath(), '{ "name": "Test task", "state', "utf8");

    await expect(
      setTaskState(taskDir(taskId), { promptDraft: "new draft" }),
    ).rejects.toThrow(/unreadable task record/);

    expect(await fs.readFile(recordPath(), "utf8")).toBe(
      '{ "name": "Test task", "state',
    );
  });

  it("refuses a pane change against a record it could not read", async () => {
    await fs.mkdir(getTaskPrivateDir(taskDir(taskId)), { recursive: true });
    await fs.writeFile(recordPath(), "not json", "utf8");

    await expect(
      updateTaskPane(taskDir(taskId), (pane) =>
        TaskPane.openTabs(pane, [TaskPane.fileTab("output/report.pdf")]),
      ),
    ).rejects.toThrow(/unreadable task record/);
  });

  // The other half of the same rule: nothing to lose is not the same as
  // something we cannot read, and a task's first write has to land.
  it("creates the record for a task that has no file yet", async () => {
    await setTaskState(taskDir(taskId), { promptDraft: "first draft" });

    const record = await readTaskRecord(taskDir(taskId));

    expect(record.state.promptDraft).toBe("first draft");
  });

  it("takes writes again once the unreadable record is repaired", async () => {
    await fs.mkdir(getTaskPrivateDir(taskDir(taskId)), { recursive: true });
    await fs.writeFile(recordPath(), "{ truncated", "utf8");
    await expect(
      setTaskState(taskDir(taskId), { promptDraft: "refused" }),
    ).rejects.toThrow();

    await writeRecordFile({ name: "Repaired" });
    await setTaskState(taskDir(taskId), { promptDraft: "accepted" });

    const record = await readTaskRecord(taskDir(taskId));

    expect(record.settings?.name).toBe("Repaired");
    expect(record.state.promptDraft).toBe("accepted");
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

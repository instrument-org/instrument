import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TASKS_DIR_NAME } from "../constants";
import { publisher } from "../rpc/publisher";
import { FolderAttachment } from "../schemas/folder-attachment";
import { AbsolutePathSchema, WorkspaceFilePathSchema } from "../schemas/paths";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { taskDir } from "./task-dir-utils";
import { setTaskState } from "./task-record";
import { watchFileInfo } from "./watch-file-info";

const id = TaskIdSchema.parse("watch-file-info-test");
const INTERVAL_MS = 20;

let taskId: TaskId;
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "watch-file-info-test-"));
  taskId = createMockTaskConfigForDir(path.join(root, TASKS_DIR_NAME, id));
  await fs.mkdir(path.join(taskDir(taskId), "output"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

function watch(filePath: string, signal: AbortSignal) {
  return watchFileInfo({
    filePath: WorkspaceFilePathSchema.parse(filePath),
    intervalMs: INTERVAL_MS,
    signal,
    taskId,
  });
}

const hostPath = (filePath: string) => path.join(taskDir(taskId), filePath);

// A directory attached under `mountName`, replacing whatever was there. Each
// call is its own attachment, so re-attaching a folder the task had before
// carries a new id the way the app's own re-attach does.
let folderCount = 0;
async function attach(mountName: string, folder: string): Promise<void> {
  folderCount += 1;

  await setTaskState(taskDir(taskId), {
    attachedFolders: {
      [mountName]: {
        access: "read-only",
        createdAt: 0,
        id: FolderAttachment.IdSchema.parse(`folder-${folderCount}`),
        mountName,
        path: AbsolutePathSchema.parse(folder),
        source: "user",
      },
    },
  });
}

// Called twice with one name to stand a different folder behind a mount point
// the task already has.
async function attachFolder(mountName: string): Promise<string> {
  const folder = await fs.mkdtemp(path.join(root, `${mountName}-`));
  await attach(mountName, folder);
  return folder;
}

describe("watchFileInfo", () => {
  // A mount the task does not have. Traversal never gets this far -- the
  // schema on the route refuses it -- so what is left to fail closed on is a
  // path that is well formed and still resolves to nothing.
  it("answers once for a path outside everything the task can reach", async () => {
    const controller = new AbortController();
    const seen = [];

    for await (const value of watch(
      "/mnt/Not-Attached/x.png",
      controller.signal,
    )) {
      seen.push(value);
    }

    expect(seen).toEqual([null]);
  });

  it("reports a file that is already there", async () => {
    await fs.writeFile(hostPath("output/report.md"), "hello");
    const controller = new AbortController();

    for await (const value of watch("output/report.md", controller.signal)) {
      expect(value).toMatchObject({
        filename: "report.md",
        filePath: "output/report.md",
        mimeType: "text/markdown",
      });
      controller.abort();
    }
  });

  // The pane is pointed at files the agent is about to write as often as at
  // ones it already has, so an absent path is the normal case rather than an
  // edge, and it has to resolve itself when the file lands.
  it("starts on a file that does not exist yet and reports it appearing", async () => {
    const controller = new AbortController();
    const seen: (null | { modifiedAt: number })[] = [];

    for await (const value of watch("output/late.md", controller.signal)) {
      seen.push(value);
      if (value === null) {
        await fs.writeFile(hostPath("output/late.md"), "arrived");
      } else {
        controller.abort();
      }
    }

    expect(seen[0]).toBeNull();
    expect(seen.at(-1)).toMatchObject({ filename: "late.md" });
  });

  // The pane can be showing a file from an attached folder when the user
  // detaches it. Going on reporting that file's size and mtime would be
  // reporting out of a folder the task no longer has.
  it("reports the file as gone when the folder it came from is detached", async () => {
    const shared = await attachFolder("Shared");
    await fs.writeFile(path.join(shared, "note.md"), "hello");

    const controller = new AbortController();
    const seen: unknown[] = [];

    for await (const value of watch("/mnt/Shared/note.md", controller.signal)) {
      seen.push(value);
      if (value === null) {
        controller.abort();
      } else {
        await setTaskState(taskDir(taskId), { attachedFolders: {} });
        await fs.writeFile(path.join(shared, "note.md"), "changed");
      }
    }

    expect(seen[0]).toMatchObject({ filename: "note.md" });
    expect(seen.at(-1)).toBeNull();
  });

  // The detach the test above performs is noticed because the write after it
  // wakes the stat. A real detach touches nothing, so the task's own change
  // event has to be what wakes it.
  it("notices a detach that never touches the file", async () => {
    const shared = await attachFolder("Shared");
    await fs.writeFile(path.join(shared, "note.md"), "hello");

    const controller = new AbortController();
    const seen: unknown[] = [];

    for await (const value of watch("/mnt/Shared/note.md", controller.signal)) {
      seen.push(value);
      if (value === null) {
        controller.abort();
      } else {
        await setTaskState(taskDir(taskId), { attachedFolders: {} });
        publisher.publish("task.updated", { id: taskId });
      }
    }

    expect(seen[0]).toMatchObject({ filename: "note.md" });
    expect(seen.at(-1)).toBeNull();
  });

  // A folder the user takes away and puts back is the case a watch that ended
  // on the detach could not serve: the pane holds whatever the watch said last,
  // so it would sit on the missing state for a file that is there again.
  it("reports the file again when the same folder is re-attached", async () => {
    const shared = await attachFolder("Shared");
    await fs.writeFile(path.join(shared, "note.md"), "hello");

    const controller = new AbortController();
    const seen: unknown[] = [];

    for await (const value of watch("/mnt/Shared/note.md", controller.signal)) {
      seen.push(value);
      if (seen.length === 1) {
        await setTaskState(taskDir(taskId), { attachedFolders: {} });
        publisher.publish("task.updated", { id: taskId });
      } else if (value === null) {
        await attach("Shared", shared);
        publisher.publish("task.updated", { id: taskId });
      } else {
        controller.abort();
      }
    }

    expect(seen).toHaveLength(3);
    expect(seen[1]).toBeNull();
    expect(seen.at(-1)).toMatchObject({ filename: "note.md" });
  });

  // Same mount point, someone else's directory behind it. The path still
  // resolves, so asking only whether the mount exists says yes, while the stat
  // goes on reading the folder the user took away. Not the case above either:
  // the mount is back and the file stays gone, because what the watch was
  // granted was the directory rather than the name over it.
  it("stays gone when the mount name is reused for a different folder", async () => {
    const shared = await attachFolder("Shared");
    await fs.writeFile(path.join(shared, "note.md"), "hello");

    const controller = new AbortController();
    const seen: unknown[] = [];

    for await (const value of watch("/mnt/Shared/note.md", controller.signal)) {
      seen.push(value);
      if (value === null) {
        controller.abort();
      } else {
        const replacement = await attachFolder("Shared");
        await fs.writeFile(path.join(replacement, "note.md"), "someone else's");
        publisher.publish("task.updated", { id: taskId });
      }
    }

    expect(seen[0]).toMatchObject({ filename: "note.md" });
    expect(seen.at(-1)).toBeNull();
  });

  // A tab opening publishes on the same channel the detach does, and says
  // nothing about this file.
  it("keeps reporting through a task change that leaves the folder attached", async () => {
    const shared = await attachFolder("Shared");
    await fs.writeFile(path.join(shared, "note.md"), "hello");

    const controller = new AbortController();
    const seen: unknown[] = [];

    for await (const value of watch("/mnt/Shared/note.md", controller.signal)) {
      seen.push(value);
      if (seen.length === 1) {
        publisher.publish("task.stateUpdated", { id: taskId });
        await fs.writeFile(path.join(shared, "note.md"), "changed");
      } else {
        controller.abort();
      }
    }

    expect(seen.at(-1)).toMatchObject({ filename: "note.md" });
  });

  it("reports a deletion as the file being gone", async () => {
    await fs.writeFile(hostPath("output/doomed.md"), "here");
    const controller = new AbortController();
    const seen: unknown[] = [];

    for await (const value of watch("output/doomed.md", controller.signal)) {
      seen.push(value);
      if (value === null) {
        controller.abort();
      } else {
        await fs.rm(hostPath("output/doomed.md"));
      }
    }

    expect(seen.at(-1)).toBeNull();
  });
});

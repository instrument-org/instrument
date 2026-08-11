import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TASKS_DIR_NAME } from "../constants";
import { WorkspaceFilePathSchema } from "../schemas/paths";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { taskDir } from "./task-dir-utils";
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

describe("watchFileInfo", () => {
  // A mount the task does not have. Traversal never gets this far -- the
  // schema on the route refuses it -- so what is left to fail closed on is a
  // path that is well formed and still resolves to nothing.
  it("answers once for a path outside everything the task can reach", async () => {
    const controller = new AbortController();
    const seen = [];

    for await (const value of watch("/mnt/Not-Attached/x.png", controller.signal)) {
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

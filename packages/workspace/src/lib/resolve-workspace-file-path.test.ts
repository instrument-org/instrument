import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FolderAttachment } from "../schemas/folder-attachment";
import {
  AbsolutePathSchema,
  TaskDirSchema,
  WorkspaceFilePathSchema,
} from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { resolveWorkspaceFilePath } from "./resolve-workspace-file-path";
import { setTaskState } from "./task-record";

describe("resolveWorkspaceFilePath", () => {
  let photosRoot: string;
  let root: string;
  let taskId: TaskId;
  let taskRoot: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "resolve-workspace-path-"));
    taskRoot = path.join(root, "tasks", "resolve-path-task");
    photosRoot = path.join(root, "Photos");
    taskId = createMockTaskConfigForDir(taskRoot);

    await fs.mkdir(taskRoot, { recursive: true });
    await fs.mkdir(photosRoot);
    await fs.writeFile(path.join(taskRoot, "notes.txt"), "task file");
    await fs.writeFile(path.join(photosRoot, "cat.png"), "mounted file");

    await setTaskState(TaskDirSchema.parse(taskRoot), {
      attachedFolders: {
        photos: {
          access: "read-only",
          createdAt: 0,
          id: FolderAttachment.IdSchema.parse("photos-id"),
          mountName: "Photos",
          path: AbsolutePathSchema.parse(photosRoot),
          source: "user",
        },
      },
    });
  });

  afterEach(async () => {
    await fs.rm(root, { force: true, recursive: true });
  });

  it.each([
    ["notes.txt", () => path.join(taskRoot, "notes.txt")],
    ["./notes.txt", () => path.join(taskRoot, "notes.txt")],
    ["/mnt/Photos/cat.png", () => path.join(photosRoot, "cat.png")],
  ] as const)("resolves %s", async (filePath, expected) => {
    const resolved = await resolveWorkspaceFilePath({
      filePath: WorkspaceFilePathSchema.parse(filePath),
      taskId,
    });

    expect(resolved).toBe(expected());
  });

  it.each([
    { filePath: "/mnt/Unattached/cat.png", label: "an unattached mount" },
    { filePath: ".instrument/state.json", label: "the task's private dir" },
  ])("returns null for $label", async ({ filePath }) => {
    const resolved = await resolveWorkspaceFilePath({
      filePath: WorkspaceFilePathSchema.parse(filePath),
      taskId,
    });

    expect(resolved).toBeNull();
  });
});

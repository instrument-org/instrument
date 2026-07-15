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
import { getCurrentFileInfo } from "./get-file-info";
import { setTaskState } from "./task-state-store";

describe("getCurrentFileInfo", () => {
  let mountedModifiedAt: number;
  let root: string;
  let taskId: TaskId;
  let taskModifiedAt: number;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "file-info-"));
    const taskRoot = path.join(root, "tasks", "file-info-task");
    const photosRoot = path.join(root, "Photos");
    taskId = createMockTaskConfigForDir(taskRoot);

    await fs.mkdir(taskRoot, { recursive: true });
    await fs.mkdir(photosRoot);
    await fs.writeFile(path.join(taskRoot, "notes.txt"), "task file");
    await fs.writeFile(path.join(photosRoot, "cat.png"), "mounted file");
    const taskStats = await fs.stat(path.join(taskRoot, "notes.txt"));
    const mountedStats = await fs.stat(path.join(photosRoot, "cat.png"));
    taskModifiedAt = taskStats.mtimeMs;
    mountedModifiedAt = mountedStats.mtimeMs;

    await setTaskState(TaskDirSchema.parse(taskRoot), {
      attachedFolders: {
        photos: {
          createdAt: 0,
          id: FolderAttachment.IdSchema.parse("photos-id"),
          name: "Photos",
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
    ["notes.txt", "notes.txt", "text/plain", () => taskModifiedAt],
    ["/mnt/Photos/cat.png", "cat.png", "image/png", () => mountedModifiedAt],
  ] as const)(
    "returns live metadata for %s",
    async (filePath, filename, mimeType, expectedModifiedAt) => {
      const result = await getCurrentFileInfo({
        filePath: WorkspaceFilePathSchema.parse(filePath),
        taskId,
      });

      expect(result._unsafeUnwrap()).toEqual({
        filename,
        filePath,
        mimeType,
        modifiedAt: expectedModifiedAt(),
      });
    },
  );

  it("rejects a missing file", async () => {
    const result = await getCurrentFileInfo({
      filePath: WorkspaceFilePathSchema.parse("/mnt/Photos/missing.png"),
      taskId,
    });

    expect(result._unsafeUnwrapErr().message).toBe(
      "File not found: /mnt/Photos/missing.png",
    );
  });
});

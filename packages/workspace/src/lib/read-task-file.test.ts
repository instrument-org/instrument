import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FolderAttachment } from "../schemas/folder-attachment";
import { AbsolutePathSchema, TaskDirSchema } from "../schemas/paths";
import { TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfig } from "../test/helpers/mock-task-config";
import { readTaskFile } from "./read-task-file";
import { setTaskState } from "./task-record";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

describe("readTaskFile", () => {
  const id = TaskIdSchema.parse("test-task");
  let tasksDir: string;
  let dir: string;

  beforeEach(async () => {
    tasksDir = await fs.mkdtemp(path.join(os.tmpdir(), "read-task-file-"));
    dir = path.join(tasksDir, id);
    const photosDir = path.join(tasksDir, "Photos");
    await fs.mkdir(dir, { recursive: true });
    await fs.mkdir(photosDir);
    await fs.writeFile(path.join(dir, "inside.txt"), "inside contents");
    await fs.writeFile(path.join(photosDir, "cat.txt"), "mounted contents");
    // Sensitive file outside the task dir (sibling of dir under tasksDir).
    await fs.writeFile(path.join(tasksDir, "secret.txt"), "ssh private key");

    // createMockTaskConfig publishes the singleton; point it at the temp dir so
    // readTaskFile (which reads the singleton) resolves under it.
    createMockTaskConfig(id);
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      tasksDir: AbsolutePathSchema.parse(tasksDir),
    });

    await setTaskState(TaskDirSchema.parse(dir), {
      attachedFolders: {
        photos: {
          access: "read-only",
          createdAt: 0,
          id: FolderAttachment.IdSchema.parse("photos-id"),
          mountName: "Photos",
          path: AbsolutePathSchema.parse(photosDir),
          source: "user",
        },
      },
    });
  });

  afterEach(async () => {
    await fs.rm(tasksDir, { force: true, recursive: true });
  });

  it("reads a file inside the task dir", async () => {
    const buffer = await readTaskFile({
      filePath: "inside.txt",
      taskId: id,
    });
    expect(buffer?.toString("utf8")).toBe("inside contents");
  });

  it("reads a file in an attached folder by its mount path", async () => {
    const buffer = await readTaskFile({
      filePath: "/mnt/Photos/cat.txt",
      taskId: id,
    });
    expect(buffer?.toString("utf8")).toBe("mounted contents");
  });

  it.each([
    { filePath: "../secret.txt", label: "parent traversal" },
    { filePath: "./sub/../../secret.txt", label: "nested traversal" },
    { filePath: "..\\secret.txt", label: "backslash traversal" },
    { filePath: "/etc/passwd", label: "absolute path" },
  ])("fails closed for $label", async ({ filePath }) => {
    const buffer = await readTaskFile({
      filePath,
      taskId: id,
    });
    expect(buffer).toBeNull();
  });
});

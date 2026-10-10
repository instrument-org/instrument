import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WORKSPACE_SKILLS_MOUNT } from "../mount-points";
import { FolderAttachment } from "../schemas/folder-attachment";
import {
  AbsolutePathSchema,
  ChatDirSchema,
  WorkspaceDirSchema,
  WorkspaceFilePathSchema,
} from "../schemas/paths";
import { type ChatId } from "../schemas/chat-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { resolveWorkspaceFilePath } from "./resolve-workspace-file-path";
import { setChatState } from "./chat-record";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

describe("resolveWorkspaceFilePath", () => {
  let photosRoot: string;
  let root: string;
  let taskId: ChatId;
  let taskRoot: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "resolve-workspace-path-"));
    taskRoot = path.join(root, "tasks", "resolve-path-task");
    photosRoot = path.join(root, "Photos");
    taskId = createMockChatConfigForDir(taskRoot);

    await fs.mkdir(taskRoot, { recursive: true });
    await fs.mkdir(photosRoot);
    await fs.writeFile(path.join(taskRoot, "notes.txt"), "task file");
    await fs.writeFile(path.join(photosRoot, "cat.png"), "mounted file");

    await setChatState(ChatDirSchema.parse(taskRoot), {
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

  it("resolves a workspace skill's file where its source is mounted", async () => {
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      rootDir: WorkspaceDirSchema.parse(root),
    });
    const skillFile = path.join(root, "skills", "csv-table", "SKILL.md");
    await fs.mkdir(path.dirname(skillFile), { recursive: true });
    await fs.writeFile(skillFile, "---\nname: csv-table\n---\n");

    const resolved = await resolveWorkspaceFilePath({
      filePath: WorkspaceFilePathSchema.parse(
        `${WORKSPACE_SKILLS_MOUNT}/csv-table/SKILL.md`,
      ),
      taskId,
    });

    expect(resolved).toBe(skillFile);
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

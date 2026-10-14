import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AbsolutePathSchema,
  WorkspaceDirSchema,
  WorkspaceFilePathSchema,
} from "../schemas/paths";
import { workspaceLayout } from "./workspace-layout";
import { type ChatId } from "../schemas/chat-id";
import { chatFor } from "../test/helpers/chat-record";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { resolveWorkspaceFilePath } from "./resolve-workspace-file-path";
import { grantFolder } from "./chat/grants";
import { recordMovedPaths } from "./moved-paths";
import { chatDir } from "./record-folders";
import { workDir } from "./work-dir";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { getWorkspaceSkillsDir } from "./workspace-skills-dir";

describe("resolveWorkspaceFilePath", () => {
  let photosRoot: string;
  let root: string;
  let chatId: ChatId;
  let chatRoot: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "resolve-workspace-path-"));
    chatRoot = path.join(root, "tasks", "resolve-path-task");
    photosRoot = path.join(root, "Photos");
    chatId = createMockChatConfigForDir(chatRoot);

    await fs.mkdir(chatRoot, { recursive: true });
    await fs.mkdir(photosRoot);
    await fs.writeFile(path.join(chatRoot, "notes.txt"), "chat file");
    await fs.writeFile(path.join(photosRoot, "cat.png"), "mounted file");

    await grantFolder({ chatId, path: photosRoot, source: "attached" });
  });

  afterEach(async () => {
    await fs.rm(root, { force: true, recursive: true });
  });

  it.each([
    [
      "notes.txt",
      (): string => "notes.txt",
      (): string => path.join(chatRoot, "notes.txt"),
    ],
    [
      "./notes.txt",
      (): string => "./notes.txt",
      (): string => path.join(chatRoot, "notes.txt"),
    ],
    [
      "a file in a granted folder by its full path",
      (): string => path.join(photosRoot, "cat.png"),
      (): string => path.join(photosRoot, "cat.png"),
    ],
  ] as const)("resolves %s", async (_label, filePath, expected) => {
    const resolved = await resolveWorkspaceFilePath({
      filePath: WorkspaceFilePathSchema.parse(filePath()),
      chatId,
    });

    expect(resolved).toBe(expected());
  });

  it("resolves a screenshot's name kept with a plain space before PM", async () => {
    const onDisk = path.join(chatRoot, "Screenshot 2026-10-14 at 9.41.03\u202FPM.png");
    await fs.writeFile(onDisk, "shot");

    const resolved = await resolveWorkspaceFilePath({
      filePath: WorkspaceFilePathSchema.parse(
        "Screenshot 2026-10-14 at 9.41.03 PM.png",
      ),
      chatId,
    });

    expect(resolved).toBe(onDisk);
  });

  it("resolves a workspace skill's file by its full path", async () => {
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      rootDir: WorkspaceDirSchema.parse(root),
    });
    const skillFile = path.join(
      workspaceLayout(root).skillsDir,
      "csv-table",
      "SKILL.md",
    );
    await fs.mkdir(path.dirname(skillFile), { recursive: true });
    await fs.writeFile(skillFile, "---\nname: csv-table\n---\n");

    const resolved = await resolveWorkspaceFilePath({
      filePath: WorkspaceFilePathSchema.parse(
        `${getWorkspaceSkillsDir()}/csv-table/SKILL.md`,
      ),
      chatId,
    });

    expect(resolved).toBe(skillFile);
  });

  it.each([
    {
      filePath: (): string => path.join(root, "Unattached", "cat.png"),
      label: "a folder the chat does not reach",
    },
    {
      filePath: (): string => path.join(photosRoot, "escape", "secret.txt"),
      label: "a file behind a symlink out of a granted folder",
    },
  ])("returns null for $label", async ({ filePath }) => {
    await fs.mkdir(path.join(root, "Unattached"), { recursive: true });
    await fs.writeFile(path.join(root, "Unattached", "secret.txt"), "secret");
    await fs.symlink(
      path.join(root, "Unattached"),
      path.join(photosRoot, "escape"),
    );
    const resolved = await resolveWorkspaceFilePath({
      filePath: WorkspaceFilePathSchema.parse(filePath()),
      chatId,
    });

    expect(resolved).toBeNull();
  });
});

// What the person's file views ask of a chat whose records and work are two
// folders: a stored `attachments/` path is the file in the record folder, and
// a path into the chat's folder from before its work moved is where it went.
describe("resolveWorkspaceFilePath with the records apart from the work", () => {
  let root: string;
  let machineDir: string;
  let chatId: ChatId;

  beforeEach(async () => {
    root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "resolve-records-")),
    );
    const rootDir = path.join(root, "workspace");
    machineDir = path.join(root, "machine");
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      chatsDir: AbsolutePathSchema.parse(workspaceLayout(rootDir).chatsDir),
      rootDir: WorkspaceDirSchema.parse(rootDir),
      workFoldersDir: AbsolutePathSchema.parse(path.join(machineDir, "work")),
      workspaceMachineDir: AbsolutePathSchema.parse(machineDir),
    });
    chatId = chatFor();
    await fs.mkdir(path.join(chatDir(chatId), "attachments"));
    await fs.writeFile(
      path.join(chatDir(chatId), "attachments", "sent.png"),
      "sent",
    );
    await fs.mkdir(path.join(workDir(chatId), "work"), { recursive: true });
    await fs.writeFile(path.join(workDir(chatId), "work", "report.md"), "made");
    await fs.mkdir(path.join(machineDir, "work", "other", "work"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(machineDir, "work", "other", "work", "theirs.md"),
      "theirs",
    );
    await fs.mkdir(path.join(workDir(chatId), "tasks", "t-build", "output"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(workDir(chatId), "tasks", "t-build", "output", "report.md"),
      "a task's",
    );
    recordMovedPaths(machineDir, [
      {
        from: workspaceLayout(rootDir).chatsDir,
        to: path.join(machineDir, "work"),
      },
    ]);
  });

  afterEach(async () => {
    await fs.rm(root, { force: true, recursive: true });
  });

  it.each([
    [
      "what the person sent, by its stored path",
      (): string => "attachments/sent.png",
      (): null | string =>
        path.join(chatDir(chatId), "attachments", "sent.png"),
    ],
    [
      "the agent's work, by its relative path",
      (): string => "work/report.md",
      (): null | string => path.join(workDir(chatId), "work", "report.md"),
    ],
    [
      "the agent's work, by its path before it moved",
      (): string => path.join(chatDir(chatId), "work", "report.md"),
      (): null | string => path.join(workDir(chatId), "work", "report.md"),
    ],
    [
      "the chat's settings",
      (): string => path.join(chatDir(chatId), "settings.json"),
      (): null | string => null,
    ],
    [
      "another chat's work, by its path before it moved",
      (): string =>
        path.join(path.dirname(chatDir(chatId)), "other", "work", "theirs.md"),
      (): null | string => null,
    ],
    [
      "a task's file, by the path an earlier build gave its folder",
      (): string => "/tasks/t-build/output/report.md",
      (): null | string =>
        path.join(workDir(chatId), "tasks", "t-build", "output", "report.md"),
    ],
    [
      "a task's folder, by that path",
      (): string => "/tasks/t-build",
      (): null | string => path.join(workDir(chatId), "tasks", "t-build"),
    ],
    [
      "a task's file, by its path relative to the chat's folder",
      (): string => "tasks/t-build/output/report.md",
      (): null | string =>
        path.join(workDir(chatId), "tasks", "t-build", "output", "report.md"),
    ],
    [
      "a task's file that is not there",
      (): string => "/tasks/t-build/output/gone.md",
      (): null | string => null,
    ],
    [
      "the old task folders as a whole",
      (): string => "/tasks",
      (): null | string => null,
    ],
  ] as const)("resolves %s", async (_label, filePath, expected) => {
    const resolved = await resolveWorkspaceFilePath({
      filePath: WorkspaceFilePathSchema.parse(filePath()),
      chatId,
    });

    expect(resolved).toBe(expected());
  });
});

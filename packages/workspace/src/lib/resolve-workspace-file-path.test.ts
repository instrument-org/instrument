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
import { SKILLS_FOLDER_NAME } from "../constants";
import { type ChatId } from "../schemas/chat-id";
import { chatFor } from "../test/helpers/chat-record";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import {
  resolveWorkspaceFilePath,
  resolveWorkspaceFilePaths,
} from "./resolve-workspace-file-path";
import { grantFolder } from "./chat/grants";
import { chatDir } from "./record-folders";
import { workDir } from "./work-dir";
import { shellPath } from "./workspace-fs-layout";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { getWorkspaceSkillsDir } from "./workspace-skills-dir";
import { inWorkspacePath } from "./workspace-relative-path";
import { removeChatsDir } from "../test/helpers/remove-chats-dir";

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
    await removeChatsDir(root);
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
      (): string => shellPath(path.join(photosRoot, "cat.png")),
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
    const onDisk = path.join(
      chatRoot,
      "Screenshot 2026-10-14 at 9.41.03\u202FPM.png",
    );
    await fs.writeFile(onDisk, "shot");

    const resolved = await resolveWorkspaceFilePath({
      filePath: WorkspaceFilePathSchema.parse(
        "Screenshot 2026-10-14 at 9.41.03 PM.png",
      ),
      chatId,
    });

    expect(resolved).toBe(onDisk);
  });

  // A message written on another computer, where the workspace was somewhere
  // else, names the file by its place in the workspace, which is read under
  // the root this computer has. The person attached it there, so the agent's
  // rules do not take it off their screen.
  it.each([
    [
      "a granted folder",
      "Photos/cat.png",
      () => path.join(photosRoot, "cat.png"),
    ],
    [
      "a folder the chat does not reach",
      "Unattached/cat.png",
      () => path.join(root, "Unattached", "cat.png"),
    ],
  ])(
    "resolves a file kept by its place in the workspace, in %s",
    async (_label, inWorkspace, expected) => {
      setWorkspaceConfig({
        ...getWorkspaceConfig(),
        rootDir: WorkspaceDirSchema.parse(root),
      });
      await fs.mkdir(path.join(root, "Unattached"), { recursive: true });
      await fs.writeFile(path.join(root, "Unattached", "cat.png"), "secret");
      const stored = inWorkspacePath(
        path.posix.join("/Users/mac-user/Instrument", inWorkspace),
        "/Users/mac-user/Instrument",
      );

      const resolved = await resolveWorkspaceFilePath({
        filePath: WorkspaceFilePathSchema.parse(stored),
        chatId,
      });

      expect(resolved).toBe(expected());
    },
  );

  // The default workspace, before the person picks a folder, is in the app's
  // own data, which the agent's rules close.
  it("resolves a file kept by its place in a workspace in the app's data", async () => {
    const userDataDir = path.join(root, "user-data");
    const workspaceRoot = path.join(userDataDir, "workspace");
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      rootDir: WorkspaceDirSchema.parse(workspaceRoot),
      userDataDir: AbsolutePathSchema.parse(userDataDir),
    });
    await fs.mkdir(workspaceRoot, { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, "ref-doc.md"), "# Ref");

    const resolved = await resolveWorkspaceFilePath({
      filePath: WorkspaceFilePathSchema.parse("workspace:/ref-doc.md"),
      chatId,
    });

    expect(resolved).toBe(path.join(workspaceRoot, "ref-doc.md"));
  });

  // A message written on Windows keeps `C:\...`, and one path that names
  // nothing here must not take the files beside it off the screen.
  it("answers each path on its own, a malformed one with null", async () => {
    const resolved = await resolveWorkspaceFilePaths({
      chatId,
      filePaths: [
        "notes.txt",
        String.raw`C:\Users\sam\Photos\cat.png`,
        "/Users/sam//Photos/cat.png",
        "workspace:/../secret.txt",
      ],
    });

    expect(Object.fromEntries(resolved)).toEqual({
      "/Users/sam//Photos/cat.png": null,
      [String.raw`C:\Users\sam\Photos\cat.png`]: null,
      "notes.txt": path.join(chatRoot, "notes.txt"),
      "workspace:/../secret.txt": null,
    });
  });

  it("resolves a workspace skill's file by its full path", async () => {
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      rootDir: WorkspaceDirSchema.parse(root),
    });
    const skillFile = path.join(
      path.join(root, SKILLS_FOLDER_NAME),
      "csv-table",
      "SKILL.md",
    );
    await fs.mkdir(path.dirname(skillFile), { recursive: true });
    await fs.writeFile(skillFile, "---\nname: csv-table\n---\n");

    const resolved = await resolveWorkspaceFilePath({
      filePath: WorkspaceFilePathSchema.parse(
        shellPath(path.join(getWorkspaceSkillsDir(), "csv-table", "SKILL.md")),
      ),
      chatId,
    });

    expect(resolved).toBe(skillFile);
  });

  it.each([
    {
      filePath: (): string =>
        shellPath(path.join(root, "Unattached", "cat.png")),
      label: "a folder the chat does not reach",
    },
    {
      filePath: (): string =>
        shellPath(path.join(photosRoot, "escape", "secret.txt")),
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
    chatId = await chatFor();
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
  });

  afterEach(async () => {
    await removeChatsDir(root);
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
      // Nothing follows it: the app wrote the paths it stored where the work
      // went, and a path in the records is the chat's words, not the app's.
      // It is read where it says, in the records, which every chat reads.
      "the agent's work, by its path before it moved",
      (): string => shellPath(path.join(chatDir(chatId), "work", "report.md")),
      (): null | string => path.join(chatDir(chatId), "work", "report.md"),
    ],
    [
      "the chat's settings",
      (): string => shellPath(path.join(chatDir(chatId), "settings.json")),
      (): null | string => path.join(chatDir(chatId), "settings.json"),
    ],
    [
      "another chat's work, by its path before it moved",
      (): string =>
        shellPath(
          path.join(
            path.dirname(chatDir(chatId)),
            "other",
            "work",
            "theirs.md",
          ),
        ),
      (): null | string =>
        path.join(path.dirname(chatDir(chatId)), "other", "work", "theirs.md"),
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

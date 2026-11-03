import { okAsync } from "neverthrow";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { chatReach } from "../permissions/chat-rules";
import { moveProjectFolders } from "../permissions/move-project-folders";
import {
  permissionsFileIn,
  readPermissionSettings,
  reachOf,
} from "../permissions/rules";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import {
  createProject,
  listProjects,
  PROJECT_FILE_NAME,
  projectsDir,
  updateProject,
} from "./projects";

// Which project the chat is filed under, as its session says.
const filed = vi.hoisted(() => ({ project: undefined as string | undefined }));

vi.mock(import("../record-folders"), async (importOriginal) => ({
  ...(await importOriginal()),
  sessionOfChat: () => StoreId.newSessionId(),
}));
vi.mock(import("../chat-reads"), () => ({
  ChatReads: {
    session: () => okAsync({ project: filed.project } as never),
  } as never,
}));

const chatId = ChatIdSchema.parse("chat-project-reach");
let root: string;
let machineDir: string;
let outside: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "project-reach-"));
  machineDir = fs.mkdtempSync(path.join(os.tmpdir(), "project-reach-machine-"));
  // A folder of the person's, outside the workspace and the home folder,
  // which nothing but a grant opens to a change.
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "project-reach-outside-"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(path.join(root, "chats")),
    rootDir: WorkspaceDirSchema.parse(root),
    workspaceMachineDir: AbsolutePathSchema.parse(machineDir),
  });
  filed.project = undefined;
});

afterEach(() => {
  for (const dir of [root, machineDir, outside]) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

/** Writes a `folders:` key into a project's file, as the agent could. */
function listInProjectFile(name: string, folder: string) {
  const file = path.join(projectsDir(), name, PROJECT_FILE_NAME);
  const text = fs.readFileSync(file, "utf8");
  fs.writeFileSync(
    file,
    text.replace(/\n---\n/, `\nfolders:\n  - path: ${folder}\n---\n`),
  );
}

/** Leaves the permission settings a build before this one kept on this computer. */
function ranHereBefore() {
  fs.writeFileSync(permissionsFileIn(machineDir), "{}\n");
}

/** Whether the chat reaches `folder`, and what its rules say to a change in it. */
async function reachOfChat(folder: string) {
  const { folders, rules } = await chatReach(chatId);
  return {
    reached: Object.keys(folders).includes(folder),
    write: reachOf(rules, path.join(folder, "notes.md"), "write").level,
  };
}

describe("a project's folders", () => {
  it("are reached from this computer's permission settings", async () => {
    const project = await createProject({ name: "Taxes" });
    filed.project = project.id;

    await updateProject(project.id, { folders: [{ path: outside }] });

    expect(await reachOfChat(outside)).toEqual({
      reached: true,
      write: "allow",
    });
    expect(
      fs.readFileSync(
        path.join(projectsDir(), "Taxes", PROJECT_FILE_NAME),
        "utf8",
      ),
    ).not.toContain(outside);
    expect((await listProjects())[0]?.folders).toEqual([{ path: outside }]);
  });

  it("are never widened by a `folders:` key written into the project's file", async () => {
    const project = await createProject({ name: "Taxes" });
    filed.project = project.id;
    moveProjectFolders({ machineDir, rootDir: root });

    listInProjectFile("Taxes", outside);

    expect(await reachOfChat(outside)).toEqual({
      reached: false,
      write: "ask",
    });
    // Nor by the launch after, which has moved what the file listed once.
    expect(moveProjectFolders({ machineDir, rootDir: root })).toEqual({
      moved: 0,
    });
    expect(await reachOfChat(outside)).toEqual({
      reached: false,
      write: "ask",
    });
  });
});

describe("moveProjectFolders", () => {
  it("takes what a project's file listed onto this computer once, and out of the file", async () => {
    const project = await createProject({ name: "Taxes" });
    filed.project = project.id;
    listInProjectFile("Taxes", outside);
    ranHereBefore();

    expect(moveProjectFolders({ machineDir, rootDir: root })).toEqual({
      moved: 1,
    });

    expect((await readPermissionSettings()).projects).toEqual({
      [project.id]: {
        folders: [{ addedAt: expect.any(Date), path: outside }],
      },
    });
    const file = fs.readFileSync(
      path.join(projectsDir(), "Taxes", PROJECT_FILE_NAME),
      "utf8",
    );
    expect(file).not.toContain("folders");
    expect(file).toContain(`id: ${project.id}`);
    expect(await reachOfChat(outside)).toEqual({
      reached: true,
      write: "allow",
    });
  });

  it("keeps what this computer already granted, with the file's after it", async () => {
    const project = await createProject({ name: "Taxes" });
    const held = fs.mkdtempSync(path.join(outside, "held-"));
    await updateProject(project.id, { folders: [{ path: held }] });
    listInProjectFile("Taxes", outside);

    moveProjectFolders({ machineDir, rootDir: root });

    expect((await listProjects())[0]?.folders).toEqual([
      { path: held },
      { path: outside },
    ]);
  });

  it("takes in nothing on a computer opening the workspace for the first time", async () => {
    const project = await createProject({ name: "Taxes" });
    filed.project = project.id;
    listInProjectFile("Taxes", outside);

    expect(moveProjectFolders({ machineDir, rootDir: root })).toEqual({
      moved: 0,
    });

    expect((await readPermissionSettings()).projects).toEqual({});
    expect(await reachOfChat(outside)).toEqual({
      reached: false,
      write: "ask",
    });
    // The file is left for the computer that granted it, and no launch of
    // this one reads it after.
    expect(
      fs.readFileSync(
        path.join(projectsDir(), "Taxes", PROJECT_FILE_NAME),
        "utf8",
      ),
    ).toContain(outside);
    expect(moveProjectFolders({ machineDir, rootDir: root })).toEqual({
      moved: 0,
    });
    expect(await reachOfChat(outside)).toEqual({
      reached: false,
      write: "ask",
    });
  });
});

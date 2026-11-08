import { call } from "@orpc/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { readPermissionSettings } from "../../lib/permissions/rules";
import { PROJECT_FILE_NAME, projectsDir } from "../../lib/chat/projects";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../../lib/workspace-config";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { type WorkspaceRPCContext } from "../base";
import { projects } from "./projects";

// Whether granting a project's folders fails, which a test sets.
const grant = vi.hoisted(() => ({ fails: false }));
vi.mock(
  import("../../lib/permissions/project-folders"),
  async (importOriginal) => {
    const original = await importOriginal();
    return {
      ...original,
      setProjectFolders: (
        ...args: Parameters<typeof original.setProjectFolders>
      ) =>
        grant.fails
          ? Promise.reject(new Error("permissions.json is not writable"))
          : original.setProjectFolders(...args),
    };
  },
);

function createContext(): WorkspaceRPCContext {
  return {
    workspaceConfig: getWorkspaceConfig(),
    // These routes never read the actor ref, so the cast spares the test
    // booting a workspace machine it would not use.
    workspaceRef: undefined as unknown as WorkspaceRPCContext["workspaceRef"],
  };
}

let root: string;
let folder: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "projects-route-"));
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "projects-route-folder-"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(root),
    workspaceMachineDir: AbsolutePathSchema.parse(`${root}-machine`),
  });
  grant.fails = false;
});

afterEach(() => {
  for (const dir of [root, `${root}-machine`, folder]) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

function list() {
  return call(projects.list, undefined, { context: createContext() });
}

function get(projectId: string) {
  return call(projects.get, { projectId }, { context: createContext() });
}

it("makes a project with its instructions and folders in one call", async () => {
  const created = await call(
    projects.create,
    {
      color: "#3b6ef6",
      emoji: "🌱",
      folders: [{ path: folder }],
      instructions: "  Answer in metric.  ",
      name: "Garden",
    },
    { context: createContext() },
  );

  expect(await get(created.id)).toMatchObject({
    folders: [{ path: folder }],
    id: created.id,
    instructions: "Answer in metric.",
    name: "Garden",
  });
  const [listed] = await list();
  expect(listed).toMatchObject({ id: created.id, name: "Garden" });
  expect(listed).not.toHaveProperty("instructions");
  expect(listed).not.toHaveProperty("folders");
  expect(
    fs.readFileSync(
      path.join(projectsDir(), "Garden", PROJECT_FILE_NAME),
      "utf8",
    ),
  ).toContain("Answer in metric.");
  const settings = await readPermissionSettings();
  expect(
    settings.projects[created.id]?.folders.map((each) => each.path),
  ).toEqual([folder]);
});

it("leaves no project behind when its folders cannot be granted", async () => {
  grant.fails = true;
  await expect(
    call(
      projects.create,
      { folders: [{ path: folder }], instructions: "Notes", name: "Garden" },
      { context: createContext() },
    ),
  ).rejects.toThrow();

  expect(await list()).toEqual([]);
  expect(fs.existsSync(path.join(projectsDir(), "Garden"))).toBe(false);
});

it("keeps a folder of the person's that stood where a failed project was made", async () => {
  const theirs = path.join(projectsDir(), "Garden");
  fs.mkdirSync(theirs, { recursive: true });
  fs.writeFileSync(path.join(theirs, "seeds.txt"), "tomatoes");
  grant.fails = true;

  await expect(
    call(
      projects.create,
      { folders: [{ path: folder }], name: "Garden" },
      { context: createContext() },
    ),
  ).rejects.toThrow();

  expect(fs.readdirSync(theirs)).toEqual(["seeds.txt"]);
});

it("puts a retired project back as it was when its folders cannot be granted", async () => {
  const first = await call(
    projects.create,
    { instructions: "Old words", name: "Garden" },
    { context: createContext() },
  );
  await call(
    projects.retire,
    { projectId: first.id },
    { context: createContext() },
  );
  grant.fails = true;

  await expect(
    call(
      projects.create,
      {
        folders: [{ path: folder }],
        instructions: "New words",
        name: "Garden",
      },
      { context: createContext() },
    ),
  ).rejects.toThrow();

  expect(await get(first.id)).toMatchObject({
    id: first.id,
    instructions: "Old words",
    retired: true,
  });
});

it("returns a project in use under the name as it is, given only the name", async () => {
  const first = await call(
    projects.create,
    { instructions: "Keep these", name: "Garden" },
    { context: createContext() },
  );

  const again = await call(
    projects.create,
    { name: "garden" },
    { context: createContext() },
  );

  expect(again.id).toBe(first.id);
});

it("refuses a name in use given instructions or folders, leaving that project alone", async () => {
  const first = await call(
    projects.create,
    { instructions: "Keep these", name: "Garden" },
    { context: createContext() },
  );

  await expect(
    call(
      projects.create,
      {
        folders: [{ path: folder }],
        instructions: "Not these",
        name: "garden",
      },
      { context: createContext() },
    ),
  ).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: "There is already a project called “Garden”",
  });
  const kept = await get(first.id);
  expect(kept?.instructions).toBe("Keep these");
  expect(kept?.folders).toBeUndefined();
});

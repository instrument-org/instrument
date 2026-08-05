import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PROJECTS_DIR_NAME, TASKS_DIR_NAME } from "../constants";
import { WorkspaceDirSchema } from "../schemas/paths";
import { ProjectSettingsSchema } from "../schemas/project";
import { newProjectId } from "../schemas/project-id";
import { TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfig } from "../test/helpers/mock-task-config";
import { absolutePathJoin } from "./absolute-path-join";
import {
  addFolderToProject,
  clearOrphanedProjectRefs,
  createProject,
  deleteProject,
  getProject,
  listInvalidProjectFolders,
  listProjects,
  removeFolderFromProject,
  setProjectFolderAccess,
  trashInvalidProjectFolder,
  updateProject,
} from "./project";
import { taskDir } from "./task-dir-utils";
import { getTaskSettings, updateTaskSettings } from "./task-settings";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

let root: string;

async function pathPresent(p: string) {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false);
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "project-lib-"));
  createMockTaskConfig(TaskIdSchema.parse("seed-task"));
  const rootDir = WorkspaceDirSchema.parse(root);
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    projectsDir: absolutePathJoin(rootDir, PROJECTS_DIR_NAME),
    rootDir,
    tasksDir: absolutePathJoin(rootDir, TASKS_DIR_NAME),
    trashItem: async (p) => {
      await fs.rm(p, { force: true, recursive: true });
    },
  });
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

describe("project lib", () => {
  it("creates a project as a named folder with id + AGENTS.md", async () => {
    const result = await createProject({
      instructions: "Be terse.",
      name: "My Project",
    });
    const created = result._unsafeUnwrap();

    expect(created.name).toBe("My Project");
    expect(created.instructions).toBe("Be terse.");
    expect(created.id).toMatch(/^prj_/);

    const dir = path.join(root, PROJECTS_DIR_NAME, "My Project");
    const settings = ProjectSettingsSchema.parse(
      JSON.parse(
        await fs.readFile(
          path.join(dir, ".instrument", "settings.json"),
          "utf8",
        ),
      ),
    );
    expect(settings.id).toBe(created.id);
    expect(await fs.readFile(path.join(dir, "AGENTS.md"), "utf8")).toBe(
      "Be terse.",
    );

    const list = await listProjects();
    expect(list.map((p) => p.id)).toContain(created.id);
  });

  it("rejects a duplicate name case-insensitively", async () => {
    await createProject({ name: "Acme" });
    const dup = await createProject({ name: "acme" });
    expect(dup.isErr()).toBe(true);
    expect(dup._unsafeUnwrapErr().type).toBe("workspace-conflict-error");
  });

  it("rejects an invalid name", async () => {
    const result = await createProject({ name: "bad/name" });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("workspace-parse-error");
  });

  it("renames the folder but keeps the id stable", async () => {
    const createResult = await createProject({ name: "Before" });
    const created = createResult._unsafeUnwrap();

    const renameResult = await updateProject(created.id, { name: "After" });
    const renamed = renameResult._unsafeUnwrap();
    expect(renamed.id).toBe(created.id);
    expect(renamed.name).toBe("After");

    expect(
      await pathPresent(path.join(root, PROJECTS_DIR_NAME, "Before")),
    ).toBe(false);

    // Still resolvable by its stable id after the folder rename.
    const fetched = await getProject(created.id);
    expect(fetched._unsafeUnwrap().name).toBe("After");
  });

  it("round-trips a description through create and update", async () => {
    const createResult = await createProject({
      description: "Marketing site work.",
      name: "Site",
    });
    const created = createResult._unsafeUnwrap();
    expect(created.description).toBe("Marketing site work.");

    const updated = await updateProject(created.id, {
      description: "Now a blog.",
    });
    expect(updated._unsafeUnwrap().description).toBe("Now a blog.");

    const fetched = await getProject(created.id);
    expect(fetched._unsafeUnwrap().description).toBe("Now a blog.");
  });

  it("adds and removes attached folders", async () => {
    const createResult = await createProject({ name: "Folders" });
    const created = createResult._unsafeUnwrap();
    expect(created.folders).toEqual([]);

    const added = await addFolderToProject(created.id, "/tmp/a", "read-write");
    expect(added._unsafeUnwrap().folders).toEqual([
      { access: "read-write", path: "/tmp/a" },
    ]);

    // Adding the same path again is a no-op (deduped), and does not change the
    // access the folder was added with.
    const again = await addFolderToProject(created.id, "/tmp/a", "read-only");
    expect(again._unsafeUnwrap().folders).toEqual([
      { access: "read-write", path: "/tmp/a" },
    ]);

    const more = await addFolderToProject(created.id, "/tmp/b", "read-only");
    expect(more._unsafeUnwrap().folders).toEqual([
      { access: "read-write", path: "/tmp/a" },
      { access: "read-only", path: "/tmp/b" },
    ]);

    const switched = await setProjectFolderAccess(
      created.id,
      "/tmp/b",
      "read-write",
    );
    expect(switched._unsafeUnwrap().folders).toEqual([
      { access: "read-write", path: "/tmp/a" },
      { access: "read-write", path: "/tmp/b" },
    ]);

    const removed = await removeFolderFromProject(created.id, "/tmp/a");
    expect(removed._unsafeUnwrap().folders).toEqual([
      { access: "read-write", path: "/tmp/b" },
    ]);

    const fetched = await getProject(created.id);
    expect(fetched._unsafeUnwrap().folders).toEqual([
      { access: "read-write", path: "/tmp/b" },
    ]);
  });

  // Folders were stored as bare path strings before access was a choice; they
  // still load, as read-only.
  it("reads folders written as plain paths", async () => {
    const createResult = await createProject({ name: "Legacy Folders" });
    const created = createResult._unsafeUnwrap();

    const settingsPath = path.join(
      root,
      PROJECTS_DIR_NAME,
      "Legacy Folders",
      ".instrument",
      "settings.json",
    );
    const settings = JSON.parse(await fs.readFile(settingsPath, "utf8")) as {
      folders: unknown;
    };
    await fs.writeFile(
      settingsPath,
      JSON.stringify({ ...settings, folders: ["/tmp/legacy"] }),
    );

    const fetched = await getProject(created.id);
    expect(fetched._unsafeUnwrap().folders).toEqual([
      { access: "read-only", path: "/tmp/legacy" },
    ]);
  });

  it("updates instructions in place", async () => {
    const createResult = await createProject({ name: "Docs" });
    const created = createResult._unsafeUnwrap();
    await updateProject(created.id, { instructions: "New rules." });
    const fetched = await getProject(created.id);
    expect(fetched._unsafeUnwrap().instructions).toBe("New rules.");
  });

  it("clears task refs to projects deleted from disk, keeps live ones", async () => {
    const keptResult = await createProject({ name: "Kept" });
    const kept = keptResult._unsafeUnwrap();
    const missingProjectId = newProjectId();

    const liveTaskId = TaskIdSchema.parse("live-task");
    const orphanTaskId = TaskIdSchema.parse("orphan-task");
    const liveWrite = await updateTaskSettings(liveTaskId, {
      name: "Live",
      projectId: kept.id,
    });
    liveWrite._unsafeUnwrap();
    const orphanWrite = await updateTaskSettings(orphanTaskId, {
      name: "Orphan",
      projectId: missingProjectId,
    });
    orphanWrite._unsafeUnwrap();

    const cleared = await clearOrphanedProjectRefs();
    expect(cleared).toEqual([orphanTaskId]);

    const orphanSettings = await getTaskSettings(taskDir(orphanTaskId));
    expect(orphanSettings?.projectId).toBeUndefined();
    const liveSettings = await getTaskSettings(taskDir(liveTaskId));
    expect(liveSettings?.projectId).toBe(kept.id);
  });

  it("deletes a project and makes it unresolvable by id", async () => {
    const createResult = await createProject({ name: "Temp" });
    const created = createResult._unsafeUnwrap();

    const deleteResult = await deleteProject(created.id);
    expect(deleteResult.isOk()).toBe(true);
    expect(await listProjects()).toEqual([]);

    const fetched = await getProject(created.id);
    expect(fetched.isErr()).toBe(true);
  });
});

describe("invalid project folders", () => {
  const settingsPath = (name: string) =>
    path.join(root, PROJECTS_DIR_NAME, name, ".instrument", "settings.json");

  it("surfaces a project folder whose settings were deleted on disk", async () => {
    const createResult = await createProject({ name: "Broken" });
    const created = createResult._unsafeUnwrap();
    await fs.rm(settingsPath("Broken"));

    // No longer loads as a project...
    const projects = await listProjects();
    expect(projects.map((p) => p.id)).not.toContain(created.id);
    // ...but is discoverable as an invalid folder.
    const invalid = await listInvalidProjectFolders();
    expect(invalid.map((f) => f.name)).toContain("Broken");
  });

  it("ignores healthy project folders", async () => {
    await createProject({ name: "Healthy" });
    expect(await listInvalidProjectFolders()).toEqual([]);
  });

  it("trashes an unloadable project folder", async () => {
    await createProject({ name: "Broken" });
    await fs.rm(settingsPath("Broken"));

    const result = await trashInvalidProjectFolder("Broken");
    expect(result.isOk()).toBe(true);
    expect(
      await pathPresent(path.join(root, PROJECTS_DIR_NAME, "Broken")),
    ).toBe(false);
  });

  it("refuses to trash a healthy project", async () => {
    await createProject({ name: "Healthy" });
    const result = await trashInvalidProjectFolder("Healthy");
    expect(result.isErr()).toBe(true);
    expect(
      await pathPresent(path.join(root, PROJECTS_DIR_NAME, "Healthy")),
    ).toBe(true);
  });

  it("refuses path traversal outside the projects dir", async () => {
    const result = await trashInvalidProjectFolder("../escape");
    expect(result.isErr()).toBe(true);
  });
});

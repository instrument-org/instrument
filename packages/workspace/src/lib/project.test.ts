import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PROJECTS_DIR_NAME, TASKS_DIR_NAME } from "../constants";
import { WorkspaceDirSchema } from "../schemas/paths";
import { ProjectSettingsSchema } from "../schemas/project";
import { TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfig } from "../test/helpers/mock-task-config";
import { absolutePathJoin } from "./absolute-path-join";
import {
  addFolderToProject,
  createProject,
  deleteProject,
  getProject,
  getProjectInstructions,
  listProjects,
  removeFolderFromProject,
  updateProject,
} from "./project";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { disposeWorkspaceStoreStorage } from "./workspace-store-storage";

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
  await disposeWorkspaceStoreStorage();
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

    const added = await addFolderToProject(created.id, "/tmp/a");
    expect(added._unsafeUnwrap().folders).toEqual(["/tmp/a"]);

    // Adding the same path again is a no-op (deduped).
    const again = await addFolderToProject(created.id, "/tmp/a");
    expect(again._unsafeUnwrap().folders).toEqual(["/tmp/a"]);

    const more = await addFolderToProject(created.id, "/tmp/b");
    expect(more._unsafeUnwrap().folders).toEqual(["/tmp/a", "/tmp/b"]);

    const removed = await removeFolderFromProject(created.id, "/tmp/a");
    expect(removed._unsafeUnwrap().folders).toEqual(["/tmp/b"]);

    expect((await getProject(created.id))._unsafeUnwrap().folders).toEqual([
      "/tmp/b",
    ]);
  });

  it("updates instructions in place", async () => {
    const createResult = await createProject({ name: "Docs" });
    const created = createResult._unsafeUnwrap();
    await updateProject(created.id, { instructions: "New rules." });
    expect(await getProjectInstructions(created.id)).toBe("New rules.");
  });

  it("deletes a project and clears it from the index", async () => {
    const createResult = await createProject({ name: "Temp" });
    const created = createResult._unsafeUnwrap();

    const deleteResult = await deleteProject(created.id);
    expect(deleteResult.isOk()).toBe(true);
    expect(await listProjects()).toEqual([]);

    const fetched = await getProject(created.id);
    expect(fetched.isErr()).toBe(true);
  });
});

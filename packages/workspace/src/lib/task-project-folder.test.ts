import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PROJECTS_DIR_NAME, TASKS_DIR_NAME } from "../constants";
import { WorkspaceDirSchema } from "../schemas/paths";
import { TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfig } from "../test/helpers/mock-task-config";
import { absolutePathJoin } from "./absolute-path-join";
import { createProject, updateProject } from "./project";
import { taskDir } from "./task-dir-utils";
import { resolveTaskProjectFolder } from "./task-project-folder";
import { updateTaskSettings } from "./task-settings";
import { getTaskState, setTaskState } from "./task-state-store";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

const taskId = TaskIdSchema.parse("mount-task");

let root: string;

async function makeProject(name: string) {
  const result = await createProject({ instructions: "Be brief.", name });
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
}

function storedHint() {
  return getTaskState(taskDir(taskId)).then((s) => s.projectFolderName);
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "task-project-folder-"));
  createMockTaskConfig(taskId);
  const rootDir = WorkspaceDirSchema.parse(root);
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    projectsDir: absolutePathJoin(rootDir, PROJECTS_DIR_NAME),
    rootDir,
    tasksDir: absolutePathJoin(rootDir, TASKS_DIR_NAME),
  });
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

describe("resolveTaskProjectFolder", () => {
  it("resolves the folder of the project the task is in", async () => {
    const project = await makeProject("Acme");
    await updateTaskSettings(taskId, { projectId: project.id });

    await expect(resolveTaskProjectFolder(taskId)).resolves.toBe("Acme");
  });

  it("resolves nothing for a task with no project", async () => {
    await updateTaskSettings(taskId, { name: "Loose task" });
    await expect(resolveTaskProjectFolder(taskId)).resolves.toBeUndefined();
  });

  // Derived from the live projectId, so joining and leaving both take effect
  // without anything having written the folder name at those moments.
  it("follows a task added to and then removed from a project", async () => {
    const project = await makeProject("Acme");

    await updateTaskSettings(taskId, { projectId: project.id });
    await expect(resolveTaskProjectFolder(taskId)).resolves.toBe("Acme");

    await updateTaskSettings(taskId, { projectId: null });
    await expect(resolveTaskProjectFolder(taskId)).resolves.toBeUndefined();
  });

  it("recovers when the stored hint names a folder that was renamed", async () => {
    const project = await makeProject("Acme");
    await updateTaskSettings(taskId, { projectId: project.id });
    await resolveTaskProjectFolder(taskId);
    expect(await storedHint()).toBe("Acme");

    await updateProject(project.id, { name: "Acme Rebrand" });

    await expect(resolveTaskProjectFolder(taskId)).resolves.toBe(
      "Acme Rebrand",
    );
    // Corrected for next time, so the scan is paid once rather than per call.
    expect(await storedHint()).toBe("Acme Rebrand");
  });

  // The hint is only ever a guess, so one pointing at a folder that now belongs
  // to a different project has to lose to the id rather than win on the name.
  it("ignores a hint whose folder holds a different project", async () => {
    const acme = await makeProject("Acme");
    const other = await makeProject("Other");
    await updateTaskSettings(taskId, { projectId: other.id });
    await setTaskState(taskDir(taskId), { projectFolderName: "Acme" });

    await expect(resolveTaskProjectFolder(taskId)).resolves.toBe("Other");
    expect(acme.id).not.toBe(other.id);
  });

  it("resolves without a hint at all", async () => {
    const project = await makeProject("Acme");
    await updateTaskSettings(taskId, { projectId: project.id });
    await setTaskState(taskDir(taskId), { projectFolderName: undefined });

    await expect(resolveTaskProjectFolder(taskId)).resolves.toBe("Acme");
  });
});

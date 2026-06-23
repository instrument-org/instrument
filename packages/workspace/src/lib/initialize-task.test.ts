import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TASK_FOLDER_NAMES } from "../constants";
import { AbsolutePathSchema } from "../schemas/paths";
import { TaskIdSchema } from "../schemas/task-id";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { initializeTask } from "./initialize-task";
import { taskDir } from "./task-dir-utils";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

let rootDir: string;

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "initialize-task-"));
});

afterEach(async () => {
  await fs.rm(rootDir, { force: true, recursive: true });
});

describe("initializeTask", () => {
  it("creates a task from the bundled default template", async () => {
    const taskId = TaskIdSchema.parse("test-task");
    createMockTaskConfigForDir(path.join(rootDir, "tasks", taskId));
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      defaultTaskTemplateDir: AbsolutePathSchema.parse(
        path.resolve(import.meta.dirname, "../../templates/default"),
      ),
    });

    const result = await initializeTask(
      {
        initialManifest: { name: "Test task" },
        taskId,
        workspaceConfig: getWorkspaceConfig(),
      },
      {},
    );

    expect(result.isOk()).toBe(true);
    expect(await listPaths(taskDir(taskId))).toMatchInlineSnapshot(`
      [
        ".gitignore",
        "output/",
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "scripts/",
        "settings.json",
        "tmp/",
        "tsconfig.json",
      ]
    `);
    await expect(
      fs.readFile(path.join(taskDir(taskId), "instrument.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.readFile(path.join(taskDir(taskId), "settings.json"), "utf8"),
    ).resolves.toMatchInlineSnapshot(`
      "{
        "name": "Test task",
        "createdWithAppVersion": "0.0.0-test"
      }"
    `);
    await expect(
      fs.readFile(path.join(taskDir(taskId), "package.json"), "utf8"),
    ).resolves.toContain('"name": "@instrument-org/task"');
    await expect(
      fs.readFile(path.join(taskDir(taskId), "pnpm-workspace.yaml"), "utf8"),
    ).resolves.not.toContain("allowBuilds");
    await expect(
      fs.access(path.join(taskDir(taskId), TASK_FOLDER_NAMES.private)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function listPaths(dir: string) {
  const paths: string[] = [];

  async function walk(relativeDir: string) {
    const entries = await fs.readdir(path.join(dir, relativeDir), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      const relativePath = path.join(relativeDir, entry.name);
      paths.push(entry.isDirectory() ? `${relativePath}/` : relativePath);
      if (entry.isDirectory()) {
        await walk(relativePath);
      }
    }
  }

  await walk("");
  return paths.sort();
}

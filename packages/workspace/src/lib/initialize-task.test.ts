import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  // The settings file is snapshotted whole, and it carries the activity stamp
  // a new task starts with.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-02T03:04:05.000Z"));
});

afterEach(async () => {
  vi.useRealTimers();
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
        initialSettings: { name: "Test task" },
        taskId,
        workspaceConfig: getWorkspaceConfig(),
      },
      {},
    );

    expect(result.isOk()).toBe(true);
    expect(await listPaths(taskDir(taskId))).toMatchInlineSnapshot(`
      [
        ".gitignore",
        ".instrument/",
        ".instrument/settings.json",
        "attachments/",
        "output/",
        "work/",
        "work/package.json",
        "work/pnpm-lock.yaml",
        "work/pnpm-workspace.yaml",
        "work/tsconfig.json",
      ]
    `);
    await expect(
      fs.readFile(path.join(taskDir(taskId), "instrument.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.readFile(
        path.join(taskDir(taskId), ".instrument", "settings.json"),
        "utf8",
      ),
    ).resolves.toMatchInlineSnapshot(`
      "{
        "name": "Test task",
        "createdWithAppVersion": "0.0.0-test",
        "lastActivityAt": "2026-01-02T03:04:05.000Z"
      }"
    `);
    await expect(
      fs.readFile(path.join(taskDir(taskId), "work", "package.json"), "utf8"),
    ).resolves.toContain('"name": "@instrument-org/task"');
    // Snapshotted in full so the supply-chain settings a task installs under
    // stay visible: weakening the age gate or the build allowlist has to show
    // up as a diff here.
    await expect(
      fs.readFile(
        path.join(taskDir(taskId), "work", "pnpm-workspace.yaml"),
        "utf8",
      ),
    ).resolves.toMatchInlineSnapshot(`
      "minimumReleaseAge: 10080
      # Declared empty so the key resolves here rather than from a task-local .npmrc,
      # a \`pnpm_config_*\` env var, or the host's global pnpm config, any of which
      # could otherwise punch per-package holes in the age gate above.
      minimumReleaseAgeExclude: []

      allowBuilds:
        sharp: true
      dlxCacheMaxAge: 259200 # 180 days in minutes, extended for pnpm dlx jiti
      packages:
        - skills/*
        - skills/*/*
      # Unapproved build scripts are skipped with a warning instead of failing the
      # install, so a package the agent adds mid-task cannot dead-end it. The bash
      # tool turns that warning into instructions for extending allowBuilds.
      strictDepBuilds: false
      # The agent runs its dev server and other pnpm commands concurrently against a
      # shared store. pnpm 11 defaults this to "install", which makes every
      # \`pnpm run\`/\`pnpm exec\` verify deps and silently spawn a competing install;
      # those race and deadlock. Install only when the agent explicitly installs.
      verifyDepsBeforeRun: false
      updateNotifier: false
      "
    `);
    await expect(
      fs.access(path.join(taskDir(taskId), TASK_FOLDER_NAMES.private)),
    ).resolves.toBeUndefined();
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

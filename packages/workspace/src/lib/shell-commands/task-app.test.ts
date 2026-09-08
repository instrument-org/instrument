import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema } from "../../schemas/paths";
import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfigForDir } from "../../test/helpers/mock-task-config";
import { createMemoryAppsConfig } from "../apps/memory-config";
import { loadApp } from "../apps/store";
import { initializeTask } from "../initialize-task";
import { taskDir } from "../task-dir-utils";
import { getTaskSettings } from "../task-settings";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { createAppCommand } from "./app";
import { runApp, type TaskCommandContext } from "./task";

const ORCHESTRATOR_ID = TaskIdSchema.parse("orchestrator");
const CHILD_ID = TaskIdSchema.parse("file-the-issue");

const context: TaskCommandContext = {
  orchestratorTaskId: ORCHESTRATOR_ID,
  remainingYieldMs: () => 0,
};

let rootDir: string;
// One store for the whole test, so a connection set through the config the
// command reads is the same one a later `useWorkspace` hands back.
let appsConfig: ReturnType<typeof createMemoryAppsConfig>;
const originalApps = getWorkspaceConfig().apps;

/** An app in the workspace, connected on the manifest it currently has. */
async function connectedApp(slug: string) {
  const result = await createAppCommand({ taskId: ORCHESTRATOR_ID }).execute(
    ["new", slug, "--name", "Linear", "--mcp", "https://mcp.example.com/sse"],
    createCommandContext({
      cwd: "/task",
      env: new Map<string, string>(),
      fs: new InMemoryFs(),
      stdin: EMPTY_BYTES,
    }),
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr);
  }
  const loaded = await loadApp(getWorkspaceConfig().appsDir, slug);
  if (loaded.isErr()) {
    throw new Error(loaded.error.message);
  }
  await getWorkspaceConfig().apps.connections.set(slug, {
    manifestHash: loaded.value.manifestHash,
    status: "connected",
    updatedAt: Date.now(),
  });
}

/** The apps a task may reach, as its settings hold them. */
async function heldBy(taskId: typeof CHILD_ID) {
  const settings = await getTaskSettings(taskDir(taskId));
  return settings?.apps;
}

/**
 * Points the workspace at this test's directories. `createMockTaskConfigForDir`
 * replaces the whole config, so anything set before it is gone and every caller
 * of it has to follow with this.
 */
function useWorkspace(taskId: string) {
  createMockTaskConfigForDir(path.join(rootDir, "tasks", taskId));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    apps: appsConfig,
    appsDir: AbsolutePathSchema.parse(path.join(rootDir, "apps")),
    defaultTaskTemplateDir: AbsolutePathSchema.parse(
      path.resolve(import.meta.dirname, "../../../templates/default"),
    ),
  });
}

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-app-"));
  appsConfig = createMemoryAppsConfig();
  useWorkspace(CHILD_ID);
  const created = await initializeTask(
    {
      initialSettings: {
        apps: [],
        kind: "task",
        name: "File the issue",
        parentTaskId: ORCHESTRATOR_ID,
      },
      taskId: CHILD_ID,
      workspaceConfig: getWorkspaceConfig(),
    },
    {},
  );
  if (created.isErr()) {
    throw created.error;
  }
});

afterEach(async () => {
  setWorkspaceConfig({ ...getWorkspaceConfig(), apps: originalApps });
  await fs.rm(rootDir, { force: true, recursive: true });
});

describe("task app", () => {
  it("hands a connected app to a task that started without one", async () => {
    await connectedApp("linear");

    const result = await runApp([CHILD_ID, "--add", "linear"], context);

    expect(result.stdout).toContain(`${CHILD_ID} can now reach linear`);
    expect(await heldBy(CHILD_ID)).toEqual(["linear"]);
  });

  it("takes an app back", async () => {
    await connectedApp("linear");
    await runApp([CHILD_ID, "--add", "linear"], context);

    const result = await runApp([CHILD_ID, "--remove", "linear"], context);

    expect(result.stdout).toContain(`Took linear back from ${CHILD_ID}`);
    expect(await heldBy(CHILD_ID)).toEqual([]);
  });

  it("does not hand the same app over twice", async () => {
    await connectedApp("linear");
    await runApp([CHILD_ID, "--add", "linear"], context);
    await runApp([CHILD_ID, "--add", "linear"], context);

    expect(await heldBy(CHILD_ID)).toEqual(["linear"]);
  });

  it("refuses an app that is not connected", async () => {
    await expect(
      runApp([CHILD_ID, "--add", "linear"], context),
    ).rejects.toThrow(/--app linear/);
    expect(await heldBy(CHILD_ID)).toEqual([]);
  });

  it("refuses to remove an app the task does not have", async () => {
    await expect(
      runApp([CHILD_ID, "--remove", "notion"], context),
    ).rejects.toThrow(/does not have "notion"/);
  });

  it("leaves the task's apps alone when one slug on the line is refused", async () => {
    await connectedApp("linear");
    await runApp([CHILD_ID, "--add", "linear"], context);

    await expect(
      runApp([CHILD_ID, "--add", "notion", "--remove", "linear"], context),
    ).rejects.toThrow(/--app notion/);

    expect(await heldBy(CHILD_ID)).toEqual(["linear"]);
  });

  it("needs one of --add or --remove", async () => {
    await expect(runApp([CHILD_ID], context)).rejects.toThrow(
      /--add or --remove is required/,
    );
  });

  it("refuses a task a person made, which already reaches every app", async () => {
    const personMade = TaskIdSchema.parse("someones-own-task");
    useWorkspace(personMade);
    const created = await initializeTask(
      {
        initialSettings: { name: "Theirs", parentTaskId: ORCHESTRATOR_ID },
        taskId: personMade,
        workspaceConfig: getWorkspaceConfig(),
      },
      {},
    );
    if (created.isErr()) {
      throw created.error;
    }
    await connectedApp("linear");

    await expect(
      runApp([personMade, "--add", "linear"], context),
    ).rejects.toThrow(/already reaches every connected app/);
  });

  it("refuses a task that is not the orchestrator's", async () => {
    await expect(
      runApp([CHILD_ID, "--add", "linear"], {
        ...context,
        orchestratorTaskId: TaskIdSchema.parse("someone-else"),
      }),
    ).rejects.toThrow(/no task "file-the-issue" of yours/);
  });
});

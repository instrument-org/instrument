import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfigForDir } from "../../test/helpers/mock-task-config";
import { encodeBrowserTargetId } from "../../types";
import { initializeTask } from "../initialize-task";
import { taskDir } from "../task-dir-utils";
import { getTaskState } from "../task-record";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { runTab, type TaskCommandContext } from "./task";

const ORCHESTRATOR_ID = TaskIdSchema.parse("orchestrator");
const CHILD_ID = TaskIdSchema.parse("read-the-page");

const context: TaskCommandContext = {
  orchestratorTaskId: ORCHESTRATOR_ID,
  remainingYieldMs: () => 0,
};

let rootDir: string;
let openTab: StoreId.Session;

/** A tab of the conversation's, open in the window the way the note lists it. */
function tabIsOpen(sessionId: StoreId.Session) {
  const config = getWorkspaceConfig();
  const targetId = encodeBrowserTargetId(ORCHESTRATOR_ID, sessionId);
  setWorkspaceConfig({
    ...config,
    browser: {
      ...config.browser,
      getTargetMeta: (asked) =>
        asked === targetId
          ? {
              id: ORCHESTRATOR_ID,
              partitionDir: AbsolutePathSchema.parse(rootDir),
              sessionId,
            }
          : null,
    },
  });
}

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-tab-"));
  for (const id of [ORCHESTRATOR_ID, CHILD_ID]) {
    createMockTaskConfigForDir(path.join(rootDir, "tasks", id));
  }
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    defaultTaskTemplateDir: AbsolutePathSchema.parse(
      path.resolve(import.meta.dirname, "../../../templates/default"),
    ),
  });
  const created = await initializeTask(
    {
      initialSettings: { name: "Read the page", parentTaskId: ORCHESTRATOR_ID },
      taskId: CHILD_ID,
      workspaceConfig: getWorkspaceConfig(),
    },
    {},
  );
  if (created.isErr()) {
    throw created.error;
  }
  openTab = StoreId.newSessionId();
  tabIsOpen(openTab);
});

afterEach(async () => {
  await fs.rm(rootDir, { force: true, recursive: true });
});

describe("task tab", () => {
  it("hands a running task one of the user's tabs", async () => {
    const result = await runTab([CHILD_ID, openTab], context);

    expect(result.stdout).toContain(`${CHILD_ID} now drives tab ${openTab}`);
    const state = await getTaskState(taskDir(CHILD_ID));
    expect(state.browserTargetId).toBe(
      encodeBrowserTargetId(ORCHESTRATOR_ID, openTab),
    );
  });

  it("takes the tab back with --none", async () => {
    await runTab([CHILD_ID, openTab], context);

    const result = await runTab([CHILD_ID, "--none"], context);

    expect(result.stdout).toContain("Took the tab back");
    const state = await getTaskState(taskDir(CHILD_ID));
    expect(state.browserTargetId).toBeUndefined();
  });

  it("says so when there was no tab to take back", async () => {
    const result = await runTab([CHILD_ID, "--none"], context);

    expect(result.stdout).toContain("browses on its own already");
  });

  it("refuses a tab that is not open any more", async () => {
    await expect(
      runTab([CHILD_ID, StoreId.newSessionId()], context),
    ).rejects.toThrow(/is not open any more/);
  });

  it("refuses something that is not a tab id", async () => {
    await expect(runTab([CHILD_ID, "the-front-page"], context)).rejects.toThrow(
      /is not a tab id/,
    );
  });

  it("needs a tab id or --none", async () => {
    await expect(runTab([CHILD_ID], context)).rejects.toThrow(
      /a tab id is required/,
    );
  });

  it("refuses a task that is not the orchestrator's", async () => {
    await expect(
      runTab([CHILD_ID, openTab], {
        ...context,
        orchestratorTaskId: TaskIdSchema.parse("someone-else"),
      }),
    ).rejects.toThrow(/no task "read-the-page" of yours/);
  });
});

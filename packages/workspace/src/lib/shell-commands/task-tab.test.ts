import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { WINDOW_ID } from "../../schemas/window-id";
import { chatFor } from "../../test/helpers/chat-record";
import { createMockTaskConfigForDir } from "../../test/helpers/mock-task-config";
import { encodeBrowserTargetId } from "../../types";
import { initializeTask } from "../initialize-task";
import { taskDir } from "../task-dir-utils";
import { getTaskState, setTaskState } from "../task-record";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { runTab, type TaskCommandContext } from "./task";
import { ChatIdSchema } from "../../schemas/chat-id";

// The chat the tasks were started in: a record of its own under `chats/`.
const CHAT_SESSION = StoreId.SessionSchema.parse(
  "ses_01M3AX9RF3C2E9RTATMB602W0B",
);
const CHAT_ID = ChatIdSchema.parse("2026-09-26-conversation");
const CHILD_ID = TaskIdSchema.parse("read-the-page");

const context: TaskCommandContext = {
  chatId: CHAT_ID,
  remainingYieldMs: () => 0,
};

let rootDir: string;
let openTab: StoreId.Session;

/** A tab of the conversation's, open in the window the way the note lists it. */
function tabIsOpen(sessionId: StoreId.Session) {
  tabsAreOpen(sessionId);
}

/** Tabs of the conversation's, open in the window the way the note lists them. */
function tabsAreOpen(...sessionIds: StoreId.Session[]) {
  const config = getWorkspaceConfig();
  const targetIds = new Set(
    sessionIds.map((sessionId) => encodeBrowserTargetId(WINDOW_ID, sessionId)),
  );
  setWorkspaceConfig({
    ...config,
    browser: {
      ...config.browser,
      getTargetMeta: (asked) =>
        targetIds.has(asked)
          ? {
              id: WINDOW_ID,
              partitionDir: AbsolutePathSchema.parse(rootDir),
              sessionId: StoreId.SessionSchema.parse(asked.split("/")[1]),
            }
          : null,
    },
  });
}

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-tab-"));
  for (const id of [CHILD_ID]) {
    createMockTaskConfigForDir(path.join(rootDir, "tasks", id), {
      unplaced: true,
    });
  }
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    // A chat's record goes under the root, kept apart from the folders
    // the test attaches.
    defaultTaskTemplateDir: AbsolutePathSchema.parse(
      path.resolve(import.meta.dirname, "../../../templates/default"),
    ),
    rootDir: WorkspaceDirSchema.parse(path.join(rootDir, "workspace")),
  });
  chatFor(CHAT_SESSION, CHAT_ID);
  const created = await initializeTask(
    {
      chatId: CHAT_ID,
      initialSettings: { name: "Read the page" },
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

    expect(result.stdout).toContain(`${CHILD_ID} now holds tabs ${openTab}`);
    const state = await getTaskState(taskDir(CHILD_ID));
    expect(state.browserTabs).toEqual([
      { id: encodeBrowserTargetId(WINDOW_ID, openTab), openedBy: "handed" },
    ]);
  });

  it("lets go of every tab with --none", async () => {
    await runTab([CHILD_ID, openTab], context);

    const result = await runTab([CHILD_ID, "--none"], context);

    expect(result.stdout).toContain("let go of every tab it held");
    const state = await getTaskState(taskDir(CHILD_ID));
    expect(state.browserTabs).toBeUndefined();
  });

  it("says so when there was no tab to let go of", async () => {
    const result = await runTab([CHILD_ID, "--none"], context);

    expect(result.stdout).toContain("holds no tabs");
  });

  it("adds a tab to the ones it holds, and lets go of one", async () => {
    const second = StoreId.newSessionId();
    tabsAreOpen(openTab, second);
    await runTab([CHILD_ID, openTab], context);

    await runTab([CHILD_ID, "--add", second], context);
    const { browserTabs: both } = await getTaskState(taskDir(CHILD_ID));
    await runTab([CHILD_ID, "--remove", openTab], context);
    const { browserTabs: left } = await getTaskState(taskDir(CHILD_ID));

    expect(both?.map((held) => held.id)).toEqual([
      encodeBrowserTargetId(WINDOW_ID, openTab),
      encodeBrowserTargetId(WINDOW_ID, second),
    ]);
    expect(left).toEqual([
      { id: encodeBrowserTargetId(WINDOW_ID, second), openedBy: "handed" },
    ]);
  });

  it("keeps the tabs a task opened itself when it is handed others", async () => {
    const own = encodeBrowserTargetId(WINDOW_ID, StoreId.newSessionId());
    await setTaskState(taskDir(CHILD_ID), {
      browserTabs: [{ id: own, openedBy: "task" }],
    });

    await runTab([CHILD_ID, openTab], context);

    const state = await getTaskState(taskDir(CHILD_ID));
    expect(state.browserTabs).toEqual([
      { id: own, openedBy: "task" },
      { id: encodeBrowserTargetId(WINDOW_ID, openTab), openedBy: "handed" },
    ]);
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

  it("needs a tab id, --add, --remove or --none", async () => {
    await expect(runTab([CHILD_ID], context)).rejects.toThrow(
      /name the tabs to hand over/,
    );
  });

  it("refuses a task another chat started", async () => {
    await expect(
      runTab([CHILD_ID, openTab], {
        ...context,
        chatId: ChatIdSchema.parse("someone-else"),
      }),
    ).rejects.toThrow(/"read-the-page" was started in another chat/);
  });
});

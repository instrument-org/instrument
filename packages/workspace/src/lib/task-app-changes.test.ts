import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { ChatIdSchema } from "../schemas/chat-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { detectTaskAppChanges } from "./task-app-changes";
import { setTaskAppsBaseline } from "./task-apps-baseline";
import { updateChatSettings } from "./chat-settings";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { initializeTaskInChat } from "../test/helpers/initialize-task-in-chat";

// A task of its own per test: the session store is cached by task id, so a
// second task under one name in a fresh temp directory reuses the handle on the
// database the last one deleted, which answers every write as readonly.
let taskCount = 0;
let TASK_ID: ReturnType<typeof ChatIdSchema.parse>;

let rootDir: string;
let sessionId: StoreId.Session;

async function changesSince(baseline: string[]) {
  const set = await setTaskAppsBaseline(TASK_ID, sessionId, baseline);
  if (set.isErr()) {
    throw set.error;
  }
  const result = await detectTaskAppChanges({
    messageId: StoreId.newMessageId(),
    sessionId,
    taskId: TASK_ID,
  });
  if (result.isErr()) {
    throw result.error;
  }
  return result.value?.type === "data-taskAppChanges"
    ? result.value.data
    : undefined;
}

async function nowHolds(apps: string[]) {
  const result = await updateChatSettings(TASK_ID, { apps });
  if (result.isErr()) {
    throw result.error;
  }
}

/**
 * Points the workspace at this test's directories. `createMockChatConfigForDir`
 * replaces the whole config, so anything set before it is gone and every caller
 * of it has to follow with this.
 */
function useWorkspace(taskId: string) {
  createMockChatConfigForDir(path.join(rootDir, "tasks", taskId), {
    unplaced: true,
  });
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    // Chats go under a workspace of the test's own, beside its folders.
    chatsDir: AbsolutePathSchema.parse(
      path.join(path.join(rootDir, "workspace"), "chats"),
    ),
    rootDir: WorkspaceDirSchema.parse(path.join(rootDir, "workspace")),
    appsDir: AbsolutePathSchema.parse(path.join(rootDir, "apps")),
    defaultTaskTemplateDir: AbsolutePathSchema.parse(
      path.resolve(import.meta.dirname, "../../templates/default"),
    ),
  });
}

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-app-changes-"));
  TASK_ID = ChatIdSchema.parse(`file-the-issue-${++taskCount}`);
  useWorkspace(TASK_ID);
  await initializeTaskInChat({
    initialSettings: { apps: [], name: "File the issue" },
    taskId: TASK_ID,
  });
  sessionId = StoreId.newSessionId();
});

afterEach(async () => {
  await fs.rm(rootDir, { force: true, recursive: true });
});

describe("detectTaskAppChanges", () => {
  it("reports an app handed over while the task was waiting on it", async () => {
    await nowHolds(["linear"]);

    const changes = await changesSince([]);

    expect(changes?.added).toEqual([{ name: "linear", slug: "linear" }]);
    expect(changes?.removed).toEqual([]);
  });

  it("reports an app taken back", async () => {
    await nowHolds([]);

    const changes = await changesSince(["linear"]);

    expect(changes?.removed).toEqual([{ name: "linear", slug: "linear" }]);
  });

  it("reports nothing when the apps are as the model last saw them", async () => {
    await nowHolds(["linear"]);

    expect(await changesSince(["linear"])).toBeUndefined();
  });

  it("says nothing to a task a person made, which reaches every app", async () => {
    const personMade = ChatIdSchema.parse(`someones-own-task-${taskCount}`);
    useWorkspace(personMade);
    await initializeTaskInChat({
      initialSettings: { name: "Theirs" },
      taskId: personMade,
    });

    const result = await detectTaskAppChanges({
      messageId: StoreId.newMessageId(),
      sessionId,
      taskId: personMade,
    });

    expect(result.isOk() && result.value).toBeUndefined();
  });
});

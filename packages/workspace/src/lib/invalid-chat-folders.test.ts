import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type AbsolutePath, WorkspaceDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { TaskIdSchema } from "../schemas/task-id";
import { chatFor } from "../test/helpers/chat-record";
import {
  listInvalidChatFolders,
  trashInvalidChatFolder,
} from "./invalid-chat-folders";
import { chatTaskIds, forgetRecordFolders, placeTask } from "./record-folders";
import { Store } from "./store";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

vi.mock(import("./session-store-storage"));

let root: string;
let trashed: string[];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "invalid-chat-folders-"));
  trashed = [];
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(root),
    tasksDir: WorkspaceDirSchema.parse(path.join(root, "tasks")),
    trashItem: (target: AbsolutePath) => {
      trashed.push(target);
      fs.rmSync(target, { force: true, recursive: true });
      return Promise.resolve();
    },
  });
  forgetRecordFolders();
});

afterEach(() => {
  forgetRecordFolders();
  fs.rmSync(root, { force: true, recursive: true });
});

/** A readable chat, with its session saved. */
async function chat() {
  const sessionId = StoreId.newSessionId();
  const id = chatFor(sessionId);
  const saved = await Store.saveSession(
    { createdAt: new Date(), id: sessionId, title: "Chat" },
    id,
  );
  expect(saved.isOk()).toBe(true);
  return id;
}

/** A task folder inside a chat, with these settings when there are any. */
function chatTask(
  chatId: ReturnType<typeof chatFor>,
  name: string,
  settings?: string,
) {
  const dir = placeTask(TaskIdSchema.parse(name), chatId);
  fs.mkdirSync(path.join(dir, ".instrument"), { recursive: true });
  if (settings !== undefined) {
    fs.writeFileSync(path.join(dir, ".instrument", "settings.json"), settings);
  }
  return dir;
}

describe("listInvalidChatFolders", () => {
  it("lists a chat's task whose settings are missing or unreadable, creating nothing in it", async () => {
    const id = await chat();
    chatTask(id, "2026-09-30-fine", JSON.stringify({ name: "Fine" }));
    const missing = chatTask(id, "2026-09-30-no-settings");
    chatTask(id, "2026-09-30-truncated", '{"name": "Half');

    const invalid = await listInvalidChatFolders();

    expect(
      invalid
        .map((folder) => ({
          ...folder,
          name: path.relative(id, folder.name),
        }))
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    ).toMatchInlineSnapshot(`
      [
        {
          "kind": "chat-task",
          "name": "tasks/2026-09-30-no-settings",
          "reason": "Missing or unreadable settings (.instrument/settings.json)",
        },
        {
          "kind": "chat-task",
          "name": "tasks/2026-09-30-truncated",
          "reason": "Missing or unreadable settings (.instrument/settings.json)",
        },
      ]
    `);
    expect(fs.readdirSync(path.join(missing, ".instrument"))).toEqual([]);
  });
});

describe("trashInvalidChatFolder", () => {
  it("trashes a chat's unreadable task and forgets it, leaving the chat", async () => {
    const id = await chat();
    const dir = chatTask(id, "2026-09-30-truncated", '{"name": "Half');

    const result = await trashInvalidChatFolder(
      path.join(id, "tasks", "2026-09-30-truncated"),
      getWorkspaceConfig(),
    );

    expect(result.isOk()).toBe(true);
    expect(trashed).toEqual([dir]);
    expect(chatTaskIds(id)).toEqual([]);
    expect(await listInvalidChatFolders()).toEqual([]);
  });
});

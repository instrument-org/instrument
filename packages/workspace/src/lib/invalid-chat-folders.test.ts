import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type AbsolutePath,
  AbsolutePathSchema,
  WorkspaceDirSchema,
} from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { chatFor } from "../test/helpers/chat-record";
import {
  listInvalidChatFolders,
  trashInvalidChatFolder,
} from "./invalid-chat-folders";
import { chatDir, forgetChatFolders } from "./record-folders";
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
    chatsDir: AbsolutePathSchema.parse(path.join(root, "chats")),
    rootDir: WorkspaceDirSchema.parse(root),
    legacyTasksDir: WorkspaceDirSchema.parse(path.join(root, "tasks")),
    trashItem: (target: AbsolutePath) => {
      trashed.push(target);
      fs.rmSync(target, { force: true, recursive: true });
      return Promise.resolve();
    },
  });
  forgetChatFolders();
});

afterEach(() => {
  forgetChatFolders();
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

/** A folder in a chat's leftover `tasks/`, with these settings when there are any. */
function leftoverTask(
  chatId: ReturnType<typeof chatFor>,
  name: string,
  settings?: string,
) {
  const dir = path.join(chatDir(chatId), "tasks", name);
  fs.mkdirSync(path.join(dir, ".instrument"), { recursive: true });
  if (settings !== undefined) {
    fs.writeFileSync(path.join(dir, ".instrument", "settings.json"), settings);
  }
  return dir;
}

describe("listInvalidChatFolders", () => {
  // A chat's leftover `tasks/` is read by nothing, so nothing in it is a
  // chat the list leaves out.
  it("leaves a chat's leftover tasks/ folder alone", async () => {
    const id = await chat();
    leftoverTask(id, "2026-09-30-no-settings");
    leftoverTask(id, "2026-09-30-truncated", '{"name": "Half');

    expect(await listInvalidChatFolders()).toEqual([]);
  });
});

describe("trashInvalidChatFolder", () => {
  it("refuses a folder the scan does not report", async () => {
    const id = await chat();
    const dir = leftoverTask(id, "2026-09-30-truncated", '{"name": "Half');

    const result = await trashInvalidChatFolder(
      path.join(id, "tasks", "2026-09-30-truncated"),
      getWorkspaceConfig(),
    );

    expect(result.isErr()).toBe(true);
    expect(trashed).toEqual([]);
    expect(fs.existsSync(dir)).toBe(true);
  });
});

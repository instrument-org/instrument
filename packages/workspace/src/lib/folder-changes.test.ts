import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { ChatIdSchema } from "../schemas/chat-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { grantFolder, revokeGrant } from "./chat/grants";
import { detectFolderChanges } from "./folder-changes";
import { setFoldersBaseline } from "./folders-baseline";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { initializeTestChat } from "../test/helpers/initialize-test-chat";

// A chat of its own per test: the session store is cached by chat id, so a
// second chat under one name in a fresh temp directory reuses the handle on the
// database the last one deleted, which answers every write as readonly.
let chatCount = 0;
let CHAT_ID: ReturnType<typeof ChatIdSchema.parse>;

let rootDir: string;
let sessionId: StoreId.Session;
let downloads: string;

async function changesSince(baseline: { name: string; path: string }[]) {
  const set = await setFoldersBaseline(CHAT_ID, sessionId, baseline);
  if (set.isErr()) {
    throw set.error;
  }
  const result = await detectFolderChanges({
    messageId: StoreId.newMessageId(),
    sessionId,
    chatId: CHAT_ID,
  });
  if (result.isErr()) {
    throw result.error;
  }
  return result.value?.type === "data-folderChanges"
    ? result.value.data
    : undefined;
}

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "folder-changes-"));
  downloads = path.join(rootDir, "Downloads");
  await fs.mkdir(downloads, { recursive: true });
  CHAT_ID = ChatIdSchema.parse(`find-the-vault-${++chatCount}`);
  createMockChatConfigForDir(path.join(rootDir, "tasks", CHAT_ID), {
    unplaced: true,
  });
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    // Chats go under a workspace of the test's own, beside its folders.
    chatsDir: AbsolutePathSchema.parse(
      path.join(path.join(rootDir, "workspace"), "chats"),
    ),
    rootDir: WorkspaceDirSchema.parse(path.join(rootDir, "workspace")),
    defaultTaskTemplateDir: AbsolutePathSchema.parse(
      path.resolve(import.meta.dirname, "../../templates/default"),
    ),
  });
  await initializeTestChat({
    initialSettings: { name: "Find the vault" },
    chatId: CHAT_ID,
  });
  sessionId = StoreId.newSessionId();
});

afterEach(async () => {
  await fs.rm(rootDir, { force: true, recursive: true });
});

describe("detectFolderChanges", () => {
  it("reports a folder granted between turns", async () => {
    await grantFolder({ chatId: CHAT_ID, path: downloads, source: "card" });

    const changes = await changesSince([]);

    expect(changes?.added).toEqual([
      { access: "read-write", name: "Downloads", path: downloads },
    ]);
  });

  it("reports a removal beside a folder granted since", async () => {
    const gone = path.join(rootDir, "Old");
    await fs.mkdir(gone);
    await grantFolder({ chatId: CHAT_ID, path: gone, source: "card" });
    await grantFolder({ chatId: CHAT_ID, path: downloads, source: "card" });
    await revokeGrant({ chatId: CHAT_ID, path: gone });

    const changes = await changesSince([{ name: "Old", path: gone }]);

    expect(changes?.added).toEqual([
      { access: "read-write", name: "Downloads", path: downloads },
    ]);
    expect(changes?.removed).toEqual([{ name: "Old", path: gone }]);
  });

  it("reports nothing when the folders are as the model last saw them", async () => {
    await grantFolder({ chatId: CHAT_ID, path: downloads, source: "card" });

    const changes = await changesSince([
      { name: "Downloads", path: downloads },
    ]);

    expect(changes).toBeUndefined();
  });
});

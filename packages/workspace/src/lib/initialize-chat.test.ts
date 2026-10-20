import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { ChatIdSchema } from "../schemas/chat-id";
import { StoreId } from "../schemas/store-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { initializeChat } from "./initialize-chat";
import { DEVICE_ID_PATTERN } from "./records/device-id";
import { chatDir } from "./record-folders";
import { workDir } from "./work-dir";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { removeChatsDir } from "../test/helpers/remove-chats-dir";

// This computer's id, which every test run makes a fresh one of.
const DEVICE_ID = new RegExp(DEVICE_ID_PATTERN, "g");

let rootDir: string;

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "initialize-chat-"));
  // The settings file is snapshotted whole, and it carries the activity stamp
  // a new task starts with.
});

afterEach(async () => {
  await removeChatsDir(rootDir);
});

/**
 * A workspace of the test's own, with its machine folder beside it, as the
 * app keeps one outside the workspace.
 */
function useWorkspaceOfItsOwn() {
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(
      path.join(rootDir, "workspace", "chats"),
    ),
    rootDir: WorkspaceDirSchema.parse(path.join(rootDir, "workspace")),
    workFoldersDir: AbsolutePathSchema.parse(
      path.join(rootDir, "machine", "work"),
    ),
    workspaceMachineDir: AbsolutePathSchema.parse(
      path.join(rootDir, "machine"),
    ),
  });
}

describe("initializeChat", () => {
  it("makes a chat's record folder, and no work folder until its first command", async () => {
    const chatId = ChatIdSchema.parse("test-task");
    createMockChatConfigForDir(path.join(rootDir, "tasks", "unused"), {
      unplaced: true,
    });
    useWorkspaceOfItsOwn();

    const result = await initializeChat({
      chatId,
      sessionId: StoreId.SessionSchema.parse("ses_01M3AX9RF3C2E9RTATMB602W0B"),
    });

    expect(result.isOk()).toBe(true);
    // Its session's log, started with the chat, and nothing beside it: the
    // log's header is what says the chat's own session, its start and build.
    expect(
      (await listPaths(chatDir(chatId))).map((name) =>
        name.replaceAll(DEVICE_ID, "<device>"),
      ),
    ).toMatchInlineSnapshot(`
      [
        "ses_01M3AX9RF3C2E9RTATMB602W0B.<device>.jsonl",
      ]
    `);
    await expect(fs.access(workDir(chatId))).rejects.toMatchObject({
      code: "ENOENT",
    });
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

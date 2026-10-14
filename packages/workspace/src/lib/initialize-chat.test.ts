import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { ChatIdSchema } from "../schemas/chat-id";
import { StoreId } from "../schemas/store-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { initializeChat } from "./initialize-chat";
import { chatDir } from "./record-folders";
import { workDir } from "./work-dir";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T[\d:.]+Z/g;

let rootDir: string;

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "initialize-chat-"));
  // The settings file is snapshotted whole, and it carries the activity stamp
  // a new task starts with.
});

afterEach(async () => {
  await fs.rm(rootDir, { force: true, recursive: true });
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
      initialSettings: {},
      sessionId: StoreId.SessionSchema.parse("ses_01M3AX9RF3C2E9RTATMB602W0B"),
      workspaceConfig: getWorkspaceConfig(),
    });

    expect(result.isOk()).toBe(true);
    expect(await listPaths(chatDir(chatId))).toMatchInlineSnapshot(`
      [
        "chat.db",
        "settings.json",
      ]
    `);
    await expect(fs.access(workDir(chatId))).rejects.toMatchObject({
      code: "ENOENT",
    });
    // Stamps normalized rather than frozen: faking the clock for a snapshot
    // leaves every real timer in the file faked too, which is a flake waiting
    // for the suite to run under load.
    const settings = await fs.readFile(
      path.join(chatDir(chatId), "settings.json"),
      "utf8",
    );
    expect(settings.replaceAll(ISO_TIMESTAMP, "<when>")).toMatchInlineSnapshot(`
      "{
        "chatSessionId": "ses_01M3AX9RF3C2E9RTATMB602W0B",
        "createdAt": "<when>",
        "createdWithAppVersion": "0.0.0-test",
        "lastActivityAt": "<when>"
      }"
    `);
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

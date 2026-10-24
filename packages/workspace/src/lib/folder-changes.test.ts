import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { type ToldFolders } from "../schemas/told";
import { ChatIdSchema } from "../schemas/chat-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { folderReach } from "./chat/folder-reach";
import { grantFolder } from "./chat/grants";
import { chatRules } from "./permissions/chat-rules";
import { reachOf } from "./permissions/rules";
import { newDeviceId } from "./records/device-id";
import { detectFolderChanges } from "./folder-changes";
import { sessionOfChat } from "./record-folders";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { shellPath } from "./workspace-fs-layout";
import { initializeTestChat } from "../test/helpers/initialize-test-chat";
import { removeChatsDir } from "../test/helpers/remove-chats-dir";
import { writeBaseline, writeMessage } from "../test/helpers/told-history";

// A chat of its own per test: a chat's records are read back whole, so a
// second case under one name would be told what the first one was.
let chatCount = 0;
let CHAT_ID: ReturnType<typeof ChatIdSchema.parse>;

let rootDir: string;
let sessionId: StoreId.Session;
let downloads: string;

async function changesSince(baseline: ToldFolders) {
  await writeBaseline(CHAT_ID, sessionId, { folders: baseline });
  return detect();
}

/** The note the next message would carry, written with it as a turn does. */
async function detect() {
  const result = await detectFolderChanges({
    messageId: StoreId.newMessageId(),
    sessionId,
    chatId: CHAT_ID,
  });
  if (result.isErr()) {
    throw result.error;
  }
  await writeMessage(CHAT_ID, sessionId, "user", [result.value]);
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
    // A chat's grants live in this computer's permission settings, so each
    // case needs a machine folder of its own as much as a chat of its own.
    workspaceMachineDir: AbsolutePathSchema.parse(
      path.join(rootDir, "machine"),
    ),
  });
  await initializeTestChat({
    chatId: CHAT_ID,
  });
  // What a turn is diffed against is written into the session's own log, so
  // the session is the chat's, as the one a turn runs in always is.
  const session = sessionOfChat(CHAT_ID);
  if (!session) {
    throw new Error("expected the chat's session");
  }
  sessionId = session;
});

afterEach(async () => {
  await removeChatsDir(rootDir);
});

describe("detectFolderChanges", () => {
  it("reports a folder granted between turns", async () => {
    await grantFolder({ chatId: CHAT_ID, path: downloads, source: "card" });

    const changes = await changesSince([]);

    expect(changes?.added).toEqual([
      {
        agentPath: shellPath(downloads),
        device: getWorkspaceConfig().deviceId,
        path: downloads,
      },
    ]);
  });

  it("reports a removal beside a folder granted since", async () => {
    const gone = path.join(rootDir, "Old");
    await fs.mkdir(gone);
    await grantFolder({ chatId: CHAT_ID, path: downloads, source: "card" });

    const changes = await changesSince([
      { device: getWorkspaceConfig().deviceId, path: gone },
    ]);

    expect(changes?.added).toEqual([
      {
        agentPath: shellPath(downloads),
        device: getWorkspaceConfig().deviceId,
        path: downloads,
      },
    ]);
    expect(changes?.removed).toEqual([
      {
        agentPath: shellPath(gone),
        device: getWorkspaceConfig().deviceId,
        path: gone,
      },
    ]);
  });

  it("reports nothing when the folders are as the model last saw them", async () => {
    await grantFolder({ chatId: CHAT_ID, path: downloads, source: "card" });

    const changes = await changesSince([
      { device: getWorkspaceConfig().deviceId, path: downloads },
    ]);

    expect(changes).toBeUndefined();
  });

  it("reports nothing before the session has a baseline", async () => {
    await grantFolder({ chatId: CHAT_ID, path: downloads, source: "card" });

    expect(await detect()).toBeUndefined();
  });

  it("counts a folder the last note told as told", async () => {
    await grantFolder({ chatId: CHAT_ID, path: downloads, source: "card" });
    expect((await changesSince([]))?.added).toEqual([
      {
        agentPath: shellPath(downloads),
        device: getWorkspaceConfig().deviceId,
        path: downloads,
      },
    ]);

    expect(await detect()).toBeUndefined();
  });

  // A grant is one computer's. A folder told on another computer, or in a
  // baseline from before the computer was recorded, was never this one's to
  // take back: here it is simply not granted, and reaching for it asks.
  it.each([
    ["another computer", { device: newDeviceId() }],
    ["no computer recorded", {}],
  ])("reports nothing for a folder told on %s", async (_name, told) => {
    const elsewhere = path.join(rootDir, "Elsewhere");

    expect(await changesSince([{ ...told, path: elsewhere }])).toBeUndefined();
  });
});

describe("a chat continued on a second computer", () => {
  it("neither removes nor mounts the first computer's folders, and asks", async () => {
    const project = path.join(rootDir, "Project");
    await fs.mkdir(project);
    // The first computer: the folder granted there, and a baseline that
    // told it.
    await grantFolder({ chatId: CHAT_ID, path: project, source: "attached" });
    expect(await changesSince([])).toMatchObject({
      added: [{ path: project }],
    });

    // The second computer reads the same records with a permission file of
    // its own, which grants nothing.
    const first = getWorkspaceConfig();
    setWorkspaceConfig({
      ...first,
      deviceId: newDeviceId(),
      workspaceMachineDir: AbsolutePathSchema.parse(
        path.join(rootDir, "second-machine"),
      ),
    });

    expect(await detect()).toBeUndefined();
    expect(Object.keys(await folderReach(CHAT_ID))).not.toContain(project);
    // Changing anything there asks, as in a folder this chat never had.
    expect(
      reachOf(
        await chatRules({ chatId: CHAT_ID }),
        path.join(project, "notes.md"),
        "write",
      ).level,
    ).toBe("ask");

    // Back on the first computer, its grant still holds and nothing changed.
    setWorkspaceConfig(first);
    expect(await detect()).toBeUndefined();
    expect(
      reachOf(
        await chatRules({ chatId: CHAT_ID }),
        path.join(project, "notes.md"),
        "write",
      ).level,
    ).toBe("allow");
  });
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { ChatIdSchema } from "../schemas/chat-id";
import { WINDOW_ID } from "../schemas/window-id";
import { chatFolderName } from "./chat-folder-name";
import { getChatInfos } from "./chat-info";
import { initializeChat } from "./initialize-chat";
import { newChatId } from "./new-chat-id";
import {
  chatDir,
  chatIdTaken,
  chatOfSession,
  forgetChat,
  forgetChatFolders,
  resolveChat,
  sessionOfChat,
} from "./record-folders";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

const SESSION = StoreId.SessionSchema.parse("ses_01M3AX9RF3C2E9RTATMB602W0B");

let rootDir: string;

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "record-folders-"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatTemplateDir: AbsolutePathSchema.parse(
      path.join(rootDir, "template"),
    ),
    chatsDir: AbsolutePathSchema.parse(path.join(rootDir, "chats")),
    rootDir: WorkspaceDirSchema.parse(rootDir),
    legacyTasksDir: WorkspaceDirSchema.parse(path.join(rootDir, "tasks")),
  });
  await fs.mkdir(path.join(rootDir, "template"));
  forgetChatFolders();
});

afterEach(async () => {
  forgetChatFolders();
  await fs.rm(rootDir, { force: true, recursive: true });
});

/**
 * A task folder inside a chat, as an earlier version left a fork, which
 * nothing reads now.
 */
async function leaveTaskFolder(chat: string, name: string) {
  const dir = path.join(rootDir, "chats", chat, "tasks", name, ".instrument");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "settings.json"),
    JSON.stringify({ fork: true, name, workdir: chat }),
  );
  return name;
}

async function makeChat(name: string, sessionId = SESSION) {
  const chatId = ChatIdSchema.parse(name);
  const made = await initializeChat({
    chatId,
    initialSettings: { name: "Instrument" },
    sessionId,
    workspaceConfig: getWorkspaceConfig(),
  });
  expect(made.isOk()).toBe(true);
  return chatId;
}

function relative(dir: string) {
  return path.relative(rootDir, dir);
}

describe("chat folder names", () => {
  it("names a chat the way a task is named, with a shorter slug", () => {
    const taken = new Set(["2026-09-24-transcribe-the-new-20"]);
    expect([
      chatFolderName({
        date: new Date(2026, 8, 24),
        isTaken: (name) => taken.has(name),
        title: "Transcribe the new 20-minute Just Press Record note",
      }),
      chatFolderName({
        date: new Date(2026, 8, 24),
        isTaken: () => false,
        title: "🎧",
      }),
    ]).toMatchInlineSnapshot(`
      [
        "2026-09-24-transcribe-the-new-20-2",
        "2026-09-24-chat",
      ]
    `);
  });
});

describe("record folders", () => {
  it("puts a chat under chats/, and knows no task folder inside one", async () => {
    const chat = await makeChat("2026-09-24-transcribe-a-note");
    const left = await leaveTaskFolder(chat, "2026-09-24-a-fork");

    expect(relative(chatDir(chat))).toBe("chats/2026-09-24-transcribe-a-note");
    expect(chatOfSession(SESSION)).toBe(chat);
    expect(sessionOfChat(chat)).toBe(SESSION);
    expect(resolveChat(chat)).toBe(chat);
    expect(resolveChat(left)).toBeUndefined();
    const { chats } = await getChatInfos();
    expect(chats.map((info) => info.id)).toEqual([chat]);
    expect(relative(chatDir(WINDOW_ID))).toBe(".instrument/window");
    expect(chatIdTaken(WINDOW_ID)).toBe(true);
  });

  it("finds chats from disk in a fresh process, and still no task inside one", async () => {
    const chat = await makeChat("2026-09-24-transcribe-a-note");
    const left = await leaveTaskFolder(chat, "2026-09-24-a-fork");
    forgetChatFolders();

    expect(chatOfSession(SESSION)).toBe(chat);
    expect(resolveChat(left)).toBeUndefined();
  });

  it("keeps ids unique across chats", async () => {
    const chat = await makeChat("2026-09-24-transcribe-a-note");

    expect(chatIdTaken(chat)).toBe(true);
    expect(
      newChatId({ preferredFolderName: ChatIdSchema.parse(chat) }),
    ).not.toBe(chat);
  });

  it("gives a chat the scaffold a working folder starts with", async () => {
    await fs.writeFile(path.join(rootDir, "template", "package.json"), "{}");
    const chat = await makeChat("2026-09-24-transcribe-a-note");

    expect(await fs.readdir(chatDir(chat))).toEqual(
      expect.arrayContaining(["attachments", "package.json", "work"]),
    );
  });
});

describe("resolveChat", () => {
  it("says a chat is one", async () => {
    const chat = await makeChat("2026-09-24-transcribe-a-note");

    expect(resolveChat(chat)).toBe(chat);
  });

  it.each([
    ["an id no chat has", "2026-09-24-never-made"],
    ["the window, which is no chat", WINDOW_ID],
    ["a string that is no id", "Not An Id"],
  ])("answers none for %s", (_label, id) => {
    expect(resolveChat(id)).toBeUndefined();
  });

  it("refuses a folder for an id no chat has", () => {
    expect(() => chatDir(ChatIdSchema.parse("2026-09-24-never-made"))).toThrow(
      "No chat has the id 2026-09-24-never-made.",
    );
  });

  it("finds a chat made on disk behind the index, and no task flat under tasks/", async () => {
    await makeChat("2026-09-24-a-chat");
    // The index has been read; these folders appear after it.
    await fs.mkdir(path.join(rootDir, "tasks", "made-elsewhere"), {
      recursive: true,
    });
    await fs.mkdir(
      path.join(rootDir, "chats", "2026-09-25-other", ".instrument"),
      {
        recursive: true,
      },
    );
    await fs.writeFile(
      path.join(
        rootDir,
        "chats",
        "2026-09-25-other",
        ".instrument",
        "settings.json",
      ),
      JSON.stringify({ chatSessionId: StoreId.newSessionId() }),
    );

    expect(resolveChat("made-elsewhere")).toBeUndefined();
    expect(resolveChat("2026-09-25-other")).toBe("2026-09-25-other");
  });

  it("forgets a chat once its folder is gone", async () => {
    const chat = await makeChat("2026-09-24-transcribe-a-note");
    await fs.rm(chatDir(chat), { force: true, recursive: true });
    forgetChat(chat);

    expect(resolveChat(chat)).toBeUndefined();
    expect(chatOfSession(SESSION)).toBeUndefined();
  });
});

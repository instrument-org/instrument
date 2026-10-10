import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { ChatIdSchema } from "../schemas/chat-id";
import { TaskIdSchema } from "../schemas/task-id";
import { WINDOW_ID } from "../schemas/window-id";
import { chatFolderName } from "./generate-task-folder-name";
import { getTasks } from "./get-tasks";
import { initializeChat } from "./initialize-task";
import { newTaskId } from "./new-task-id";
import {
  chatOf,
  chatOfSession,
  forgetRecord,
  forgetRecordFolders,
  recordDir,
  recordIdTaken,
  resolveChat,
  resolveRecord,
  sessionOfChat,
} from "./record-folders";
import { taskDir } from "./task-dir-utils";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

const SESSION = StoreId.SessionSchema.parse("ses_01M3AX9RF3C2E9RTATMB602W0B");

let rootDir: string;

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "record-folders-"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    defaultTaskTemplateDir: AbsolutePathSchema.parse(
      path.join(rootDir, "template"),
    ),
    rootDir: WorkspaceDirSchema.parse(rootDir),
    tasksDir: WorkspaceDirSchema.parse(path.join(rootDir, "tasks")),
  });
  await fs.mkdir(path.join(rootDir, "template"));
  forgetRecordFolders();
});

afterEach(async () => {
  forgetRecordFolders();
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
  const taskId = ChatIdSchema.parse(name);
  const made = await initializeChat({
    chatId: taskId,
    initialSettings: { name: "Instrument" },
    sessionId,
    workspaceConfig: getWorkspaceConfig(),
  });
  expect(made.isOk()).toBe(true);
  return taskId;
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

    expect(relative(taskDir(chat))).toBe("chats/2026-09-24-transcribe-a-note");
    expect(chatOfSession(SESSION)).toBe(chat);
    expect(sessionOfChat(chat)).toBe(SESSION);
    expect(resolveChat(chat)).toBe(chat);
    expect(resolveRecord(left).isErr()).toBe(true);
    const { tasks } = await getTasks();
    expect(tasks.map((task) => [task.id, task.isChat])).toEqual([[chat, true]]);
    expect(chatOf(chat)).toBe(chat);
    expect(relative(taskDir(WINDOW_ID))).toBe(".instrument/window");
    expect(recordIdTaken(WINDOW_ID)).toBe(true);
  });

  it("finds chats from disk in a fresh process, and still no task inside one", async () => {
    const chat = await makeChat("2026-09-24-transcribe-a-note");
    const left = await leaveTaskFolder(chat, "2026-09-24-a-fork");
    forgetRecordFolders();

    expect(chatOfSession(SESSION)).toBe(chat);
    expect(resolveRecord(left).isErr()).toBe(true);
  });

  it("keeps ids unique across chats", async () => {
    const chat = await makeChat("2026-09-24-transcribe-a-note");

    expect(recordIdTaken(chat)).toBe(true);
    expect(
      await newTaskId({
        preferredFolderName: TaskIdSchema.parse(chat),
        workspaceConfig: getWorkspaceConfig(),
      }),
    ).not.toBe(chat);
  });

  it("gives a chat the scaffold a working folder starts with", async () => {
    await fs.writeFile(path.join(rootDir, "template", "package.json"), "{}");
    const chat = await makeChat("2026-09-24-transcribe-a-note");

    expect(await fs.readdir(taskDir(chat))).toEqual(
      expect.arrayContaining(["attachments", "package.json", "work"]),
    );
  });
});

describe("resolveRecord", () => {
  it("says a chat is one", async () => {
    const chat = await makeChat("2026-09-24-transcribe-a-note");

    expect(resolveRecord(chat)._unsafeUnwrap()).toEqual({
      id: chat,
      kind: "chat",
    });
  });

  it.each([
    ["an id no record has", "2026-09-24-never-made"],
    ["the window, which is no record", WINDOW_ID],
    ["a string that is no id", "Not An Id"],
  ])("answers NotFound for %s", (_label, id) => {
    const resolved = resolveRecord(id);
    expect(resolved.isErr() && resolved.error.constructor.name).toBe(
      "NotFound",
    );
  });

  it("refuses a folder for an id no record has rather than guessing tasks/", () => {
    expect(() =>
      recordDir(TaskIdSchema.parse("2026-09-24-never-made")),
    ).toThrow("No record has the id 2026-09-24-never-made.");
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

    expect(resolveRecord("made-elsewhere").isErr()).toBe(true);
    expect(resolveRecord("2026-09-25-other")._unsafeUnwrap()).toEqual({
      id: "2026-09-25-other",
      kind: "chat",
    });
  });

  it("forgets a chat once its folder is gone", async () => {
    const chat = await makeChat("2026-09-24-transcribe-a-note");
    await fs.rm(taskDir(chat), { force: true, recursive: true });
    forgetRecord(chat);

    expect(resolveRecord(chat).isErr()).toBe(true);
    expect(chatOfSession(SESSION)).toBeUndefined();
  });
});

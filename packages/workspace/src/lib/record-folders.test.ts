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
import { initializeChat, initializeTask } from "./initialize-task";
import { newTaskId } from "./new-task-id";
import {
  chatOf,
  chatOfSession,
  forgetRecord,
  forgetRecordFolders,
  owningChat,
  placeTask,
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

async function make(id: string, chatId: string) {
  const taskId = TaskIdSchema.parse(id);
  const made = await initializeTask(
    {
      chatId: ChatIdSchema.parse(chatId),
      initialSettings: { name: id },
      taskId,
      workspaceConfig: getWorkspaceConfig(),
    },
    {},
  );
  expect(made.isOk()).toBe(true);
  return taskId;
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
  it("puts a chat under chats/ and its tasks inside it", async () => {
    const chat = await makeChat("2026-09-24-transcribe-a-note");
    const child = await make("2026-09-24-transcribe-the-recording", chat);

    expect([chat, child].map((id) => relative(taskDir(id))))
      .toMatchInlineSnapshot(`
        [
          "chats/2026-09-24-transcribe-a-note",
          "chats/2026-09-24-transcribe-a-note/tasks/2026-09-24-transcribe-the-recording",
        ]
      `);
    expect(chatOfSession(SESSION)).toBe(chat);
    expect(sessionOfChat(chat)).toBe(SESSION);
    expect([resolveChat(chat), resolveChat(child)]).toEqual([chat, undefined]);
    const { tasks } = await getTasks();
    expect(
      tasks
        .map((task) => [task.id, task.isChat, task.isChat ? null : task.chatId])
        .sort(),
    ).toMatchInlineSnapshot(`
      [
        [
          "2026-09-24-transcribe-a-note",
          true,
          null,
        ],
        [
          "2026-09-24-transcribe-the-recording",
          false,
          "2026-09-24-transcribe-a-note",
        ],
      ]
    `);
    expect([owningChat(child), owningChat(chat)]).toEqual([chat, undefined]);
    expect([chatOf(child), chatOf(chat)]).toEqual([chat, chat]);
    expect(relative(taskDir(WINDOW_ID))).toBe(".instrument/window");
    expect(recordIdTaken(WINDOW_ID)).toBe(true);
  });

  it("finds chats and their tasks from disk in a fresh process", async () => {
    const chat = await makeChat("2026-09-24-transcribe-a-note");
    const child = await make("2026-09-24-transcribe-the-recording", chat);
    forgetRecordFolders();

    expect(relative(taskDir(child))).toBe(
      "chats/2026-09-24-transcribe-a-note/tasks/2026-09-24-transcribe-the-recording",
    );
    expect(chatOfSession(SESSION)).toBe(chat);
  });

  it("keeps ids unique across chats and their tasks", async () => {
    const chat = await makeChat("2026-09-24-transcribe-a-note");
    await make("taken", chat);

    expect(recordIdTaken("taken")).toBe(true);
    expect(recordIdTaken(chat)).toBe(true);
    expect(
      await newTaskId({
        preferredFolderName: TaskIdSchema.parse("taken"),
        workspaceConfig: getWorkspaceConfig(),
      }),
    ).not.toBe("taken");

    forgetRecord(TaskIdSchema.parse("taken"));
    expect(recordIdTaken("taken")).toBe(false);
  });

  it("refuses a task id another chat has just taken, before either folder exists", async () => {
    const one = await makeChat("2026-09-24-one");
    const two = await makeChat("2026-09-24-two", StoreId.newSessionId());
    const id = TaskIdSchema.parse("2026-09-24-same-name");
    placeTask(id, one);

    expect(() => placeTask(id, two)).toThrow("already has the id");
    expect(relative(taskDir(id))).toBe(
      "chats/2026-09-24-one/tasks/2026-09-24-same-name",
    );
  });

  it("gives a chat none of a task's scaffold", async () => {
    await fs.writeFile(path.join(rootDir, "template", "package.json"), "{}");
    const chat = await makeChat("2026-09-24-transcribe-a-note");
    const task = await make("2026-09-24-a-task", chat);

    const chatFiles = await fs.readdir(taskDir(chat));
    expect(chatFiles).not.toContain("package.json");
    expect(await fs.readdir(taskDir(task))).toContain("package.json");
  });
});

describe("resolveRecord", () => {
  it("says what each record is, and which chat holds a task", async () => {
    const chat = await makeChat("2026-09-24-transcribe-a-note");
    const child = await make("2026-09-24-transcribe-the-recording", chat);

    expect(
      [chat, child].map((id) => resolveRecord(id)._unsafeUnwrap()),
    ).toEqual([
      { id: chat, kind: "chat" },
      { chatId: chat, id: child, kind: "task" },
    ]);
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

  it("forgets a chat with the tasks inside it", async () => {
    const chat = await makeChat("2026-09-24-transcribe-a-note");
    const child = await make("2026-09-24-transcribe-the-recording", chat);
    await fs.rm(taskDir(chat), { force: true, recursive: true });
    forgetRecord(chat);

    expect(resolveRecord(chat).isErr()).toBe(true);
    expect(resolveRecord(child).isErr()).toBe(true);
    expect(chatOfSession(SESSION)).toBeUndefined();
  });
});

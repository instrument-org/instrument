import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { TaskIdSchema } from "../schemas/task-id";
import { chatFolderName } from "./generate-task-folder-name";
import { getTasks } from "./get-tasks";
import { initializeTask } from "./initialize-task";
import { newTaskId } from "./new-task-id";
import {
  chatOfSession,
  forgetChatTask,
  forgetRecordFolders,
  isChatId,
  placeChatTask,
  recordIdTaken,
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

async function make(id: string, parentTaskId?: string) {
  const taskId = TaskIdSchema.parse(id);
  const made = await initializeTask(
    {
      initialSettings: {
        name: id,
        ...(parentTaskId
          ? { parentTaskId: TaskIdSchema.parse(parentTaskId) }
          : {}),
      },
      taskId,
      workspaceConfig: getWorkspaceConfig(),
    },
    {},
  );
  expect(made.isOk()).toBe(true);
  return taskId;
}

function relative(dir: string) {
  return path.relative(rootDir, dir);
}

async function makeChat(name: string, sessionId = SESSION) {
  const taskId = TaskIdSchema.parse(name);
  const made = await initializeTask(
    {
      initialSettings: {
        chatSessionId: sessionId,
        kind: "orchestrator",
        name: "Instrument",
      },
      taskId,
      workspaceConfig: getWorkspaceConfig(),
    },
    {},
  );
  expect(made.isOk()).toBe(true);
  return taskId;
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
  it("puts a chat under chats/, its tasks inside it, and other tasks under tasks/", async () => {
    const chat = await makeChat("2026-09-24-transcribe-a-note");
    const child = await make("2026-09-24-transcribe-the-recording", chat);
    const loose = await make("2026-08-07-dinner-near-broadway");

    expect([chat, child, loose].map((id) => relative(taskDir(id))))
      .toMatchInlineSnapshot(`
        [
          "chats/2026-09-24-transcribe-a-note",
          "chats/2026-09-24-transcribe-a-note/tasks/2026-09-24-transcribe-the-recording",
          "tasks/2026-08-07-dinner-near-broadway",
        ]
      `);
    expect(chatOfSession(SESSION)).toBe(chat);
    expect(sessionOfChat(chat)).toBe(SESSION);
    expect([isChatId(chat), isChatId(child), isChatId(loose)]).toEqual([
      true,
      false,
      false,
    ]);
    const { tasks } = await getTasks(getWorkspaceConfig());
    expect(tasks.map((task) => [task.id, task.parentTaskId ?? null]).sort())
      .toMatchInlineSnapshot(`
      [
        [
          "2026-08-07-dinner-near-broadway",
          null,
        ],
        [
          "2026-09-24-transcribe-a-note",
          null,
        ],
        [
          "2026-09-24-transcribe-the-recording",
          "2026-09-24-transcribe-a-note",
        ],
      ]
    `);
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

  it("keeps ids unique across chats, their tasks, and the flat tasks", async () => {
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

    forgetChatTask(TaskIdSchema.parse("taken"));
    expect(recordIdTaken("taken")).toBe(false);
  });

  it("refuses a task id another chat has just taken, before either folder exists", async () => {
    const one = await makeChat("2026-09-24-one");
    const two = await makeChat("2026-09-24-two", StoreId.newSessionId());
    const id = TaskIdSchema.parse("2026-09-24-same-name");
    placeChatTask(id, one);

    expect(() => placeChatTask(id, two)).toThrow("already has the id");
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

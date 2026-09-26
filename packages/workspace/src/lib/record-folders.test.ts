import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { chatIdOf, isChatId, sessionOfChat } from "../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { TaskIdSchema } from "../schemas/task-id";
import { getTasks } from "./get-tasks";
import { initializeTask } from "./initialize-task";
import { newTaskId } from "./new-task-id";
import {
  chatTaskIdTaken,
  forgetChatTask,
  forgetRecordFolders,
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

describe("chat ids", () => {
  it("round-trips a session id through a chat's record id", () => {
    const chat = chatIdOf(SESSION);
    expect(chat).toMatchInlineSnapshot(`"chat-01m3ax9rf3c2e9rtatmb602w0b"`);
    expect(sessionOfChat(chat)).toBe(SESSION);
    expect(isChatId(chat)).toBe(true);
    expect(isChatId("2026-09-24-chat-about-dinner")).toBe(false);
  });
});

describe("record folders", () => {
  it("puts a chat under chats/, its tasks inside it, and other tasks under tasks/", async () => {
    const chat = await make(chatIdOf(SESSION));
    const child = await make("2026-09-24-transcribe-a-note", chat);
    const loose = await make("2026-08-07-dinner-near-broadway");

    expect([chat, child, loose].map((id) => relative(taskDir(id))))
      .toMatchInlineSnapshot(`
        [
          "chats/chat-01m3ax9rf3c2e9rtatmb602w0b",
          "chats/chat-01m3ax9rf3c2e9rtatmb602w0b/tasks/2026-09-24-transcribe-a-note",
          "tasks/2026-08-07-dinner-near-broadway",
        ]
      `);
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
            "chat-01m3ax9rf3c2e9rtatmb602w0b",
          ],
          [
            "chat-01m3ax9rf3c2e9rtatmb602w0b",
            null,
          ],
        ]
      `);
  });

  it("finds a chat's tasks from disk in a fresh process", async () => {
    const chat = await make(chatIdOf(SESSION));
    const child = await make("2026-09-24-transcribe-a-note", chat);
    forgetRecordFolders();

    expect(relative(taskDir(child))).toBe(
      "chats/chat-01m3ax9rf3c2e9rtatmb602w0b/tasks/2026-09-24-transcribe-a-note",
    );
  });

  it("keeps task ids unique across chats and the flat tasks", async () => {
    const chat = await make(chatIdOf(SESSION));
    await make("taken", chat);

    expect(chatTaskIdTaken("taken")).toBe(true);
    expect(
      await newTaskId({
        preferredFolderName: TaskIdSchema.parse("taken"),
        workspaceConfig: getWorkspaceConfig(),
      }),
    ).not.toBe("taken");

    forgetChatTask(TaskIdSchema.parse("taken"));
    expect(chatTaskIdTaken("taken")).toBe(false);
  });

  it("gives a chat none of a task's scaffold", async () => {
    await fs.writeFile(path.join(rootDir, "template", "package.json"), "{}");
    const chat = await make(chatIdOf(SESSION));
    const task = await make("2026-09-24-a-task", chat);

    const chatFiles = await fs.readdir(taskDir(chat));
    expect(chatFiles).not.toContain("package.json");
    expect(await fs.readdir(taskDir(task))).toContain("package.json");
  });
});

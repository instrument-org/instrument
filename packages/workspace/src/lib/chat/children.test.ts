import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { TaskIdSchema } from "../../schemas/task-id";
import { WINDOW_ID } from "../../schemas/window-id";
import { chatFor } from "../../test/helpers/chat-record";
import { initializeTask } from "../initialize-task";
import { forgetRecordFolders } from "../record-folders";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { childTaskMounts, listChildTasks } from "./children";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";

let rootDir: string;

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "children-"));
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

async function make(id: string, chatId: ChatId, { fork = false } = {}) {
  const taskId = TaskIdSchema.parse(id);
  const made = await initializeTask(
    {
      chatId,
      initialSettings: {
        name: id,
        ...(fork ? { fork: true, workdir: chatId } : {}),
      },
      taskId,
      workspaceConfig: getWorkspaceConfig(),
    },
    {},
  );
  expect(made.isOk()).toBe(true);
  return taskId;
}

describe("listChildTasks", () => {
  it("gives a chat its own tasks, and the window or a task none", async () => {
    const one = chatFor();
    const two = chatFor();
    const first = await make("2026-09-26-first", one);
    const second = await make("2026-09-26-second", two);

    const ids = async (id: string) => {
      const tasks = await listChildTasks(ChatIdSchema.parse(id));
      return tasks.map((task) => task.id).sort();
    };

    expect(await ids(one)).toEqual([first]);
    expect(await ids(two)).toEqual([second]);
    // No id stands for every chat's tasks, and a task asked for its tasks
    // never walks back into its chat.
    expect(await ids(WINDOW_ID)).toEqual([]);
    expect(await ids(first)).toEqual([]);
  });

  it("leaves out a task whose settings cannot be read, and makes nothing in it", async () => {
    const chat = chatFor();
    const kept = await make("2026-09-26-kept", chat);
    const broken = path.join(
      rootDir,
      "chats",
      chat,
      "tasks",
      "2026-09-26-broken",
      ".instrument",
    );
    await fs.mkdir(broken, { recursive: true });
    await fs.writeFile(path.join(broken, "settings.json"), "{ not json");
    forgetRecordFolders();

    const tasks = await listChildTasks(chat);

    expect(tasks.map((task) => task.id)).toEqual([kept]);
    expect(await fs.readdir(broken)).toEqual(["settings.json"]);
  });
});

describe("childTaskMounts", () => {
  it("mounts a briefed task's own folder at /tasks/<id>, and no fork's", async () => {
    const chatId = chatFor(
      undefined,
      ChatIdSchema.parse("2026-10-07-a-chat-with-both"),
    );
    const briefed = await make("2026-10-01-briefed-task", chatId);
    await make("2026-10-07-a-fork", chatId, { fork: true });

    expect(
      (await childTaskMounts(chatId)).map((mount) => mount.mountPoint),
    ).toEqual([`/tasks/${briefed}`]);
  });
});

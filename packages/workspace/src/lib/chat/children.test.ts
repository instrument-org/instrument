import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { WINDOW_ID } from "../../schemas/window-id";
import { chatFor } from "../../test/helpers/chat-record";
import { chatTaskFor } from "../../test/helpers/chat-task";
import { forgetChatFolders } from "../record-folders";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import {
  addChildTask,
  chatConversation,
  isTaskSession,
  listChildTasks,
} from "./children";
import { ChatIdSchema } from "../../schemas/chat-id";

let rootDir: string;

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "children-"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatTemplateDir: AbsolutePathSchema.parse(path.join(rootDir, "template")),
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

describe("listChildTasks", () => {
  it("gives a chat the sessions it started, and the window none", async () => {
    const one = chatFor();
    const two = chatFor();
    const first = await chatTaskFor(one, { title: "First" });
    const second = await chatTaskFor(two, { title: "Second" });

    const ids = async (id: string) => {
      const tasks = await listChildTasks(ChatIdSchema.parse(id));
      return tasks.map((task) => task.id).sort();
    };

    expect(await ids(one)).toEqual([first]);
    expect(await ids(two)).toEqual([second]);
    // No id stands for every chat's tasks.
    expect(await ids(WINDOW_ID)).toEqual([]);
  });

  it("knows nothing of a tasks folder an earlier version left in a chat, and makes nothing in it", async () => {
    const chat = chatFor();
    const kept = await chatTaskFor(chat);
    const left = path.join(
      rootDir,
      "chats",
      chat,
      "tasks",
      "2026-09-26-a-fork",
      ".instrument",
    );
    await fs.mkdir(left, { recursive: true });
    await fs.writeFile(
      path.join(left, "settings.json"),
      JSON.stringify({ fork: true, name: "A fork", workdir: chat }),
    );
    forgetChatFolders();

    const tasks = await listChildTasks(chat);

    expect(tasks.map((task) => task.id)).toEqual([kept]);
    expect(await fs.readdir(left)).toEqual(["settings.json"]);
  });
});

describe("addChildTask", () => {
  it("hands out t1, t2, … in the order the chat starts them, never twice", async () => {
    const chat = chatFor();
    const at = new Date();
    const started = await Promise.all(
      ["First", "Second", "Third"].map((title) =>
        addChildTask(chat, {
          createdAt: at,
          id: StoreId.newSessionId(),
          title,
        }),
      ),
    );
    expect(started.map((task) => task.handle)).toEqual(["t1", "t2", "t3"]);
    // Another chat counts from its own first.
    const other = chatFor();
    await chatTaskFor(other);
    expect((await listChildTasks(other)).map((task) => task.handle)).toEqual([
      "t1",
    ]);
    const listed = await listChildTasks(chat);
    expect(listed.map((task) => task.handle).toSorted()).toEqual([
      "t1",
      "t2",
      "t3",
    ]);
  });
});

describe("chatConversation", () => {
  it("tells the chat's own session from a task's", async () => {
    const sessionId = StoreId.newSessionId();
    const chat = chatFor(sessionId);
    const task = await chatTaskFor(chat);

    expect(chatConversation(chat, sessionId)).toBe(chat);
    expect(chatConversation(chat, task)).toBeUndefined();
    expect(isTaskSession(chat, task)).toBe(true);
    expect(isTaskSession(chat, sessionId)).toBe(false);
  });
});

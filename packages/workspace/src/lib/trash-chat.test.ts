import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { chatFor } from "../test/helpers/chat-record";
import { chatTaskFor } from "../test/helpers/chat-task";
import { forgetRecordFolders, resolveChat } from "./record-folders";
import { Store } from "./store";
import { taskDir } from "./task-dir-utils";
import { trashChat } from "./trash-task";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { ChatIdSchema } from "../schemas/chat-id";

let rootDir: string;
let trashed: string[];

// The machine answers the browser teardown at once; nothing else is asked of it.
const workspaceRef = {
  send: (event: { type: string; value?: { onBrowserReaped?: () => void } }) => {
    event.value?.onBrowserReaped?.();
  },
} as never;

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "trash-chat-"));
  trashed = [];
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    defaultTaskTemplateDir: AbsolutePathSchema.parse(
      path.join(rootDir, "template"),
    ),
    rootDir: WorkspaceDirSchema.parse(rootDir),
    tasksDir: WorkspaceDirSchema.parse(path.join(rootDir, "tasks")),
    trashItem: async (item: string) => {
      trashed.push(path.relative(rootDir, item));
      await fs.rm(item, { force: true, recursive: true });
    },
  });
  await fs.mkdir(path.join(rootDir, "template"));
  forgetRecordFolders();
});

afterEach(async () => {
  forgetRecordFolders();
  await fs.rm(rootDir, { force: true, recursive: true });
});

describe("trashChat", () => {
  it("trashes the chat's folder once, with the tasks in its store", async () => {
    const chat = chatFor();
    await chatTaskFor(chat, { title: "First task" });
    await chatTaskFor(chat, { title: "Second task" });
    const otherChat = chatFor(
      undefined,
      ChatIdSchema.parse("2026-09-24-other"),
    );
    const other = await chatTaskFor(otherChat);

    const result = await trashChat({
      id: chat,
      workspaceConfig: getWorkspaceConfig(),
      workspaceRef,
    });

    expect(result.isOk()).toBe(true);
    expect(trashed).toEqual([`chats/${chat}`]);
    expect(resolveChat(chat)).toBeUndefined();
    await expect(fs.access(taskDir(otherChat))).resolves.toBeUndefined();
    expect((await Store.getSession(other, otherChat)).isOk()).toBe(true);
  });
});

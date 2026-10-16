import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { chatFor } from "../test/helpers/chat-record";
import { chatTaskFor } from "../test/helpers/chat-task";
import { ChatReads } from "./chat-reads";
import { forgetChatFolders, resolveChat, chatDir } from "./record-folders";
import { trashChat } from "./trash-chat";
import { workDir } from "./work-dir";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { ChatIdSchema } from "../schemas/chat-id";
import { removeChatsDir } from "../test/helpers/remove-chats-dir";

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
    chatsDir: AbsolutePathSchema.parse(path.join(rootDir, "chats")),
    rootDir: WorkspaceDirSchema.parse(rootDir),
    legacyTasksDir: WorkspaceDirSchema.parse(path.join(rootDir, "tasks")),
    trashItem: async (item: string) => {
      trashed.push(path.relative(rootDir, item));
      await fs.rm(item, { force: true, recursive: true });
    },
    workFoldersDir: AbsolutePathSchema.parse(
      path.join(rootDir, "machine", "work"),
    ),
    workspaceMachineDir: AbsolutePathSchema.parse(
      path.join(rootDir, "machine"),
    ),
  });
  await fs.mkdir(path.join(rootDir, "template"));
  forgetChatFolders();
});

afterEach(async () => {
  forgetChatFolders();
  await removeChatsDir(rootDir);
});

describe("trashChat", () => {
  it("trashes the chat's record folder once, with the tasks in its store", async () => {
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
    // Its agent never ran a command, so it has no work folder to trash.
    expect(trashed).toEqual([path.join("chats", chat)]);
    expect(resolveChat(chat)).toBeUndefined();
    await expect(fs.access(chatDir(otherChat))).resolves.toBeUndefined();
    expect(
      (await ChatReads.session({ chatId: otherChat, sessionId: other })).isOk(),
    ).toBe(true);
  });

  it("trashes the chat's work folder too, without the packages it can rebuild", async () => {
    const chat = chatFor();
    const work = workDir(chat);
    await fs.mkdir(path.join(work, "work"), { recursive: true });
    await fs.writeFile(path.join(work, "work", "report.md"), "made");
    await fs.mkdir(path.join(work, "node_modules", "left-pad"), {
      recursive: true,
    });
    const otherChat = chatFor(
      undefined,
      ChatIdSchema.parse("2026-09-24-other"),
    );
    await fs.mkdir(workDir(otherChat), { recursive: true });
    const trashedWithPackages: boolean[] = [];
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      trashItem: async (item: string) => {
        trashedWithPackages.push(
          await fs.access(path.join(item, "node_modules")).then(
            () => true,
            () => false,
          ),
        );
        trashed.push(path.relative(rootDir, item));
        await fs.rm(item, { force: true, recursive: true });
      },
    });

    const result = await trashChat({
      id: chat,
      workspaceConfig: getWorkspaceConfig(),
      workspaceRef,
    });

    expect(result.isOk()).toBe(true);
    expect(trashed).toEqual([
      path.join("chats", chat),
      path.join("machine", "work", chat),
    ]);
    expect(trashedWithPackages).toEqual([false, false]);
    await expect(fs.access(workDir(otherChat))).resolves.toBeUndefined();
  });

  it("removes the chat when its work folder will not go, and reports it", async () => {
    const chat = chatFor();
    const work = workDir(chat);
    await fs.mkdir(path.join(work, "work"), { recursive: true });
    const reported: unknown[] = [];
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      captureException: (error: unknown) => {
        reported.push(error);
      },
      trashItem: async (item: string) => {
        if (item === work) {
          throw new Error("A file in it is open");
        }
        trashed.push(path.relative(rootDir, item));
        await fs.rm(item, { force: true, recursive: true });
      },
    });

    const result = await trashChat({
      id: chat,
      workspaceConfig: getWorkspaceConfig(),
      workspaceRef,
    });

    expect(result.isOk()).toBe(true);
    expect(trashed).toEqual([path.join("chats", chat)]);
    expect(resolveChat(chat)).toBeUndefined();
    expect(reported).toEqual([new Error("A file in it is open")]);
  });

  it("lets the chat start sessions again when trashing it fails", async () => {
    const chat = chatFor();
    const sent: string[] = [];
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      trashItem: () => Promise.reject(new Error("The Trash is full")),
    });

    const result = await trashChat({
      id: chat,
      workspaceConfig: getWorkspaceConfig(),
      workspaceRef: {
        send: (event: {
          type: string;
          value?: { onBrowserReaped?: () => void };
        }) => {
          sent.push(event.type);
          event.value?.onBrowserReaped?.();
        },
      } as never,
    });

    expect(result.isErr()).toBe(true);
    expect(sent).toEqual(["prepareToTrashChat", "removeChatBeingTrashed"]);
  });
});

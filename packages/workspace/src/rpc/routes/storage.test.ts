import { call } from "@orpc/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatWrites } from "../../lib/chat-writes";
import { listChats } from "../../lib/chat/chats";
import {
  forgetChatFolders,
  resolveChat,
  sessionOfChat,
} from "../../lib/record-folders";
import { disposeSessionsStoreStorage } from "../../lib/session-store-storage";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../../lib/workspace-config";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { chatFor } from "../../test/helpers/chat-record";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { type WorkspaceRPCContext } from "../base";
import { storage } from "./storage";

// The chat list asks the machine what is running; none runs in a test.
vi.mock(import("../../lib/chat/activity"), async (importOriginal) => ({
  ...(await importOriginal()),
  chatActivity: () => Promise.resolve({ running: [] }),
}));
vi.mock(import("../../lib/workspace-actor-ref"), () => ({
  getWorkspaceActorRef: () =>
    ({
      getSnapshot: () => ({
        context: { sessionRefsByChatId: { get: () => [] } },
      }),
    }) as never,
  setWorkspaceActorRef: vi.fn(),
}));

let root: string;
let opened: ChatId[];

beforeEach(() => {
  createMockChatConfig(ChatIdSchema.parse(`storage-${Date.now()}`));
  root = fs.mkdtempSync(path.join(os.tmpdir(), "storage-route-"));
  opened = [];
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(path.join(root, "chats")),
    rootDir: WorkspaceDirSchema.parse(root),
    legacyTasksDir: WorkspaceDirSchema.parse(path.join(root, "tasks")),
    trashItem: (target) => {
      fs.rmSync(target, { force: true, recursive: true });
      return Promise.resolve();
    },
    workFoldersDir: AbsolutePathSchema.parse(
      path.join(root, "machine", "work"),
    ),
    workspaceMachineDir: AbsolutePathSchema.parse(path.join(root, "machine")),
  });
  forgetChatFolders();
});

afterEach(async () => {
  for (const id of opened) {
    await disposeSessionsStoreStorage(id);
  }
  fs.rmSync(root, { force: true, recursive: true });
});

function createContext(): WorkspaceRPCContext {
  return {
    workspaceConfig: getWorkspaceConfig(),
    // The storage routes never read the actor ref, so the cast spares the
    // test booting a workspace machine it would not use.
    workspaceRef: undefined as unknown as WorkspaceRPCContext["workspaceRef"],
  };
}

/** A chat with its session saved and one message from the user. */
async function readableChat(named: string): Promise<ChatId> {
  const sessionId = StoreId.newSessionId();
  const id = chatFor(sessionId, ChatIdSchema.parse(named));
  opened.push(id);
  const saved = await ChatWrites.saveSession(
    { createdAt: new Date(), id: sessionId, title: named },
    id,
  );
  expect(saved.isOk()).toBe(true);
  const messageId = StoreId.newMessageId();
  const said = await ChatWrites.saveMessageWithParts(
    {
      id: messageId,
      metadata: { createdAt: new Date(), sessionId },
      parts: [
        {
          metadata: {
            createdAt: new Date(),
            id: StoreId.newPartId(),
            messageId,
            sessionId,
          },
          text: "hello",
          type: "text",
        },
      ],
      role: "user",
    },
    id,
  );
  expect(said.isOk()).toBe(true);
  return id;
}

function recordFile(chatId: string, file: string) {
  return path.join(root, "chats", chatId, file);
}

async function seedBrokenChats() {
  await readableChat("2026-10-01-fine");
  await readableChat("2026-10-01-bad-settings");
  fs.writeFileSync(recordFile("2026-10-01-bad-settings", "settings.json"), "{");
  chatFor(StoreId.newSessionId(), ChatIdSchema.parse("2026-10-01-bad-db"));
  fs.writeFileSync(
    recordFile("2026-10-01-bad-db", "chat.db"),
    "not a database, just bytes long enough to be read as a header",
  );
  fs.mkdirSync(path.join(root, "chats", "Not A Chat"));
  fs.mkdirSync(
    path.join(root, "chats", "2026-10-01-fine", "tasks", "Bad Task"),
    {
      recursive: true,
    },
  );
  forgetChatFolders();
}

describe("storage.invalidFolders", () => {
  it("lists the chats the chat list leaves out, with why", async () => {
    await seedBrokenChats();

    const chats = await listChats();
    const invalid = await call(storage.invalidFolders.list, undefined, {
      context: createContext(),
    });

    expect(chats.map((chat) => chat.id)).toEqual(["2026-10-01-fine"]);
    expect(
      invalid
        .map(({ kind, name, path: at, reason }) => ({
          at: path.relative(root, at).replaceAll(path.sep, "/"),
          kind,
          name,
          reason,
        }))
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    ).toMatchInlineSnapshot(`
      [
        {
          "at": "chats/2026-10-01-bad-db",
          "kind": "chat",
          "name": "2026-10-01-bad-db",
          "reason": "Unreadable chat session (chat.db)",
        },
        {
          "at": "chats/2026-10-01-bad-settings",
          "kind": "chat",
          "name": "2026-10-01-bad-settings",
          "reason": "Missing or unreadable settings (settings.json)",
        },
        {
          "at": "chats/Not A Chat",
          "kind": "chat",
          "name": "Not A Chat",
          "reason": "Folder name can only contain lowercase letters, numbers, and hyphens",
        },
      ]
    `);
  });

  it("takes none of a picked folder's own folders for 1.x tasks", async () => {
    const { legacyTasksDir: _kept, ...picked } = getWorkspaceConfig();
    setWorkspaceConfig(picked);
    fs.mkdirSync(path.join(root, "tasks", "Field notes"), { recursive: true });
    const context = createContext();

    await expect(
      call(storage.invalidFolders.list, undefined, { context }),
    ).resolves.toEqual([]);
    await expect(
      call(
        storage.invalidFolders.trash,
        { kind: "legacy-task", name: "Field notes" },
        { context },
      ),
    ).rejects.toThrow("This workspace keeps no 1.x tasks");
    expect(fs.existsSync(path.join(root, "tasks", "Field notes"))).toBe(true);
  });

  it("trashes an unreadable chat with its work folder, and forgets it", async () => {
    await seedBrokenChats();
    const badDb = ChatIdSchema.parse("2026-10-01-bad-db");
    expect(resolveChat(badDb) !== undefined).toBe(true);
    const work = path.join(root, "machine", "work", badDb);
    fs.mkdirSync(path.join(work, "work"), { recursive: true });

    await call(
      storage.invalidFolders.trash,
      { kind: "chat", name: badDb },
      { context: createContext() },
    );
    const invalid = await call(storage.invalidFolders.list, undefined, {
      context: createContext(),
    });

    expect(fs.existsSync(path.join(root, "chats", badDb))).toBe(false);
    expect(fs.existsSync(work)).toBe(false);
    expect(invalid.map((folder) => folder.name)).not.toContain(badDb);
    expect(resolveChat(badDb) !== undefined).toBe(false);
    expect(sessionOfChat(badDb)).toBeUndefined();
  });

  it("refuses to trash a chat the list can read, or a path out of chats/", async () => {
    await seedBrokenChats();

    for (const name of ["2026-10-01-fine", "../tasks", "/"]) {
      await expect(
        call(
          storage.invalidFolders.trash,
          { kind: "chat", name },
          { context: createContext() },
        ),
      ).rejects.toThrow();
    }
    expect(fs.existsSync(path.join(root, "chats", "2026-10-01-fine"))).toBe(
      true,
    );
  });
});

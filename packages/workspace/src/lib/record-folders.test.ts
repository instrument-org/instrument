import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publisher } from "../rpc/publisher";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { type ChatId, ChatIdSchema } from "../schemas/chat-id";
import { WINDOW_ID } from "../schemas/window-id";
import { chatFolderName } from "./chat-folder-name";
import { chatSessions, chatTitle, getChatInfos } from "./chat-info";
import { ChatWrites } from "./chat-writes";
import { initializeChat } from "./initialize-chat";
import { newChatId } from "./new-chat-id";
import { writingChatRecords } from "./records/chat-records";
import { logFileName, parseRecordFileName } from "./records/file-names";
import { recordLine } from "./records/record";
import { DEVICE_A, DEVICE_B, header } from "./records/test-records";
import {
  chatDir,
  chatIds,
  chatSessionIn,
  chatIdTaken,
  chatOfSession,
  forgetChat,
  forgetChatFolders,
  loadChatIndex,
  resolveChat,
  sessionOfChat,
} from "./record-folders";
import { workDir } from "./work-dir";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

// Each test reuses its chats' names in a fresh folder, so a store kept open
// on disk would outlive the folder it was opened in.

const SESSION = StoreId.SessionSchema.parse("ses_01M3AX9RF3C2E9RTATMB602W0B");

let rootDir: string;

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "record-folders-"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(path.join(rootDir, "chats")),
    rootDir: WorkspaceDirSchema.parse(rootDir),
    legacyTasksDir: WorkspaceDirSchema.parse(path.join(rootDir, "tasks")),
  });
  await fs.mkdir(path.join(rootDir, "template"));
  forgetChatFolders();
});

afterEach(async () => {
  // The records hold what each chat they opened read, and the next test
  // makes chats of the same names in a fresh folder.
  for (const chatId of opened.splice(0)) {
    await writingChatRecords()?.close(chatId);
  }
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

const opened: ChatId[] = [];

async function makeChat(name: string, sessionId = SESSION) {
  const chatId = ChatIdSchema.parse(name);
  opened.push(chatId);
  const made = await initializeChat({
    chatId,
    sessionId,
  });
  expect(made.isOk()).toBe(true);
  return chatId;
}

/** Where `dir` is in the workspace, spelled with `/` on every platform. */
function relative(dir: string) {
  return path.relative(rootDir, dir).replaceAll(path.sep, "/");
}

describe("chat folder names", () => {
  it("names a migrated 1.x task's chat the way a task was named, with a shorter slug", () => {
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
    const chats = await getChatInfos({
      direction: "desc",
      sortBy: "updatedAt",
    });
    expect(chats.map((info) => info.id)).toEqual([chat]);
    // The window keeps its scope's id, and no record folder.
    expect(() => chatDir(WINDOW_ID)).toThrow("No chat has the id window.");
    expect(chatIdTaken(WINDOW_ID)).toBe(true);
  });

  it("finds chats from disk in a fresh process, and still no task inside one", async () => {
    const chat = await makeChat("2026-09-24-transcribe-a-note");
    const left = await leaveTaskFolder(chat, "2026-09-24-a-fork");
    forgetChatFolders();
    await loadChatIndex();

    expect(chatOfSession(SESSION)).toBe(chat);
    expect(resolveChat(left)).toBeUndefined();
  });

  it("keeps ids unique across chats", async () => {
    const chat = await makeChat("2026-09-24-transcribe-a-note");

    expect(chatIdTaken(chat)).toBe(true);
    const fallback = newChatId({
      preferredFolderName: ChatIdSchema.parse(chat),
      prompt: "Transcribe a note",
    });
    expect(fallback).not.toBe(chat);
    expect(fallback).toMatch(
      /^\d{4}-\d{2}-\d{2}-transcribe-a-note-[0-9a-z]{4}$/,
    );
  });

  it("makes a chat's records, and no work folder until its agent needs one", async () => {
    await fs.writeFile(path.join(rootDir, "template", "package.json"), "{}");
    const chat = await makeChat("2026-09-24-transcribe-a-note");

    expect(
      (await fs.readdir(chatDir(chat))).map(
        (name) => parseRecordFileName(name)?.kind,
      ),
    ).toEqual(["log"]);
    await expect(fs.access(workDir(chat))).rejects.toThrow(/ENOENT/);
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
    await fs.mkdir(path.join(rootDir, "chats", "2026-09-25-other"), {
      recursive: true,
    });
    const other = StoreId.newSessionId();
    await fs.writeFile(
      path.join(
        rootDir,
        "chats",
        "2026-09-25-other",
        logFileName(other, DEVICE_A),
      ),
      recordLine(header(0, { device: DEVICE_A, id: other })),
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

describe("a chat's own session", () => {
  /** A log of `id` from `device`, holding its header and nothing else. */
  async function writeHeader(
    dir: string,
    id: StoreId.Session,
    device: typeof DEVICE_A,
    parent?: StoreId.Session,
  ) {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, logFileName(id, device)),
      recordLine(header(0, { device, id, ...(parent && { parent }) })),
    );
  }

  const OWN = StoreId.SessionSchema.parse("ses_01M3AX9RF3C2E9RTATMB602W0B");
  // Older than the chat's own, which no task the app starts ever is, so the
  // headers have to be read rather than the names sorted.
  const TASK = StoreId.SessionSchema.parse("ses_01M3AX9RF3C2E9RTATMB602W0A");

  it("is the session no other one was started from, whichever device wrote it", async () => {
    const dir = path.join(rootDir, "chats", "2026-09-25-two-devices");
    await writeHeader(dir, TASK, DEVICE_A, OWN);
    await writeHeader(dir, OWN, DEVICE_B);

    expect(await chatSessionIn(dir)).toBe(OWN);
  });

  it.each([
    ["missing", undefined],
    ["damaged", '{"chatSessionId": "ses_'],
    ["naming another session", JSON.stringify({ chatSessionId: TASK })],
  ])("lists a chat whose settings.json is %s", async (_what, settings) => {
    const dir = path.join(rootDir, "chats", "2026-09-25-settings");
    await writeHeader(dir, OWN, DEVICE_A);
    if (settings !== undefined) {
      await fs.writeFile(path.join(dir, "settings.json"), settings);
    }

    expect(sessionOfChat(ChatIdSchema.parse("2026-09-25-settings"))).toBe(OWN);
    const chats = await getChatInfos({
      direction: "desc",
      sortBy: "updatedAt",
    });
    expect(chats.map((info) => info.id)).toEqual(["2026-09-25-settings"]);
    opened.push(ChatIdSchema.parse("2026-09-25-settings"));
  });

  it("is what a chat still on its chat.db named in settings.json, until it has records", async () => {
    const dir = path.join(rootDir, "chats", "2026-09-25-on-its-database");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "settings.json"),
      JSON.stringify({ chatSessionId: OWN }),
    );

    expect(await chatSessionIn(dir)).toBe(OWN);
  });

  it("is none for a folder holding only a task's log, until the chat's own arrives", async () => {
    const dir = path.join(rootDir, "chats", "2026-09-25-task-first");
    await writeHeader(dir, TASK, DEVICE_A, OWN);

    expect(await chatSessionIn(dir)).toBeUndefined();
    expect(resolveChat("2026-09-25-task-first")).toBeUndefined();

    await writeHeader(dir, OWN, DEVICE_B);

    expect(resolveChat("2026-09-25-task-first")).toBe("2026-09-25-task-first");
    expect(sessionOfChat(ChatIdSchema.parse("2026-09-25-task-first"))).toBe(
      OWN,
    );
  });

  it("is none for a folder of several sessions where no header is the chat's own", async () => {
    const dir = path.join(rootDir, "chats", "2026-09-25-no-root");
    const other = StoreId.SessionSchema.parse("ses_01M3AX9RF3C2E9RTATMB602W0C");
    await writeHeader(dir, TASK, DEVICE_A, OWN);
    await writeHeader(dir, other, DEVICE_A, OWN);
    // The chat's own log, started and not yet given its header.
    await fs.writeFile(path.join(dir, logFileName(OWN, DEVICE_B)), "");

    expect(await chatSessionIn(dir)).toBeUndefined();
  });

  it("is none for a folder with neither", async () => {
    const dir = path.join(rootDir, "chats", "2026-09-25-empty");
    await fs.mkdir(dir, { recursive: true });

    expect(await chatSessionIn(dir)).toBeUndefined();
  });
});

describe("the index read before its first use", () => {
  const OWN = StoreId.SessionSchema.parse("ses_01M3AX9RF3C2E9RTATMB602W0B");
  const NAME = ChatIdSchema.parse("2026-10-30-from-another-device");

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function writeChat(name: ChatId) {
    const dir = path.join(rootDir, "chats", name);
    await fs.mkdir(dir, { recursive: true });
    const log = path.join(dir, logFileName(OWN, DEVICE_A));
    await fs.writeFile(
      log,
      recordLine(header(0, { device: DEVICE_A, id: OWN })),
    );
    return log;
  }

  /** What reads a file's contents, synchronously or not. */
  function spyOnReads() {
    return [
      vi.spyOn(fsSync, "openSync"),
      vi.spyOn(fsSync, "readFileSync"),
      vi.spyOn(fsSync, "readSync"),
      vi.spyOn(fsSync.promises, "open"),
      vi.spyOn(fsSync.promises, "readFile"),
    ];
  }

  /** Every file stats as one with contents and no blocks on disk: kept in the cloud only. */
  function evictEverything() {
    const stat = fsSync.promises.stat;
    vi.spyOn(fsSync.promises, "stat").mockImplementation(async (file) =>
      Object.assign(await stat(file), { blocks: 0 }),
    );
    const statSync = fsSync.statSync;
    vi.spyOn(fsSync, "statSync").mockImplementation((file) =>
      Object.assign(statSync(file), { blocks: 0 }),
    );
  }

  it("answers from memory once loadChatIndex has read it", async () => {
    await writeChat(NAME);
    await loadChatIndex();
    const reads = spyOnReads();

    expect(chatIds()).toEqual([NAME]);
    expect(resolveChat(NAME)).toBe(NAME);
    expect(sessionOfChat(NAME)).toBe(OWN);
    expect(chatOfSession(OWN)).toBe(NAME);
    expect(reads.map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0, 0, 0]);
  });

  it.runIf(process.platform === "darwin")(
    "adds a chat whose log is kept by name only once it downloads",
    async () => {
      const log = await writeChat(NAME);
      evictEverything();
      const publish = vi.spyOn(publisher, "publish");
      // Held until the test lets the download finish.
      let download = () => undefined as void;
      const downloaded = new Promise<void>((resolve) => {
        download = resolve;
      });
      const realOpen = fsSync.promises.open;
      const open = vi
        .spyOn(fsSync.promises, "open")
        .mockImplementation(async (...args) => {
          await downloaded;
          return realOpen(...args);
        });

      await loadChatIndex();

      expect(chatIds()).toEqual([]);
      download();
      await vi.waitFor(() => {
        expect(chatIds()).toEqual([NAME]);
      });
      expect(open.mock.calls.map(([file]) => file)).toEqual([log]);
      expect(publish).toHaveBeenCalledWith("record.changed", {
        id: NAME,
        kind: "session",
      });
    },
  );

  it.runIf(process.platform === "darwin")(
    "passes over a log kept by name only when looking for a chat it has not seen, and adds the chat once it downloads",
    async () => {
      await loadChatIndex();
      const log = await writeChat(NAME);
      evictEverything();
      const readSync = vi.spyOn(fsSync, "readSync");
      const readFileSync = vi.spyOn(fsSync, "readFileSync");

      expect(resolveChat(NAME)).toBeUndefined();
      expect(readSync).not.toHaveBeenCalled();
      expect(readFileSync).not.toHaveBeenCalled();
      await vi.waitFor(() => {
        expect(chatIds()).toEqual([NAME]);
      });
      expect(resolveChat(NAME)).toBe(NAME);
      expect(log).toContain(NAME);
    },
  );
});

describe("chat titles", () => {
  // The chat list shows an untitled chat by its opening words, and every
  // other reader of its title (a report, a chip) has to say the same.
  it("reads an untitled chat by its opening ask, as the list shows it", async () => {
    const chat = await makeChat("2026-10-22-hello-world");
    const createdAt = new Date();
    const messageId = StoreId.newMessageId();
    const written = await ChatWrites.saveMessageWithParts(
      {
        id: messageId,
        metadata: { createdAt, sessionId: SESSION },
        parts: [
          {
            metadata: {
              createdAt,
              id: StoreId.newPartId(),
              messageId,
              sessionId: SESSION,
            },
            text: "hello world",
            type: "text",
          },
        ],
        role: "user",
      },
      chat,
    );
    expect(written.isOk()).toBe(true);

    expect(await chatTitle(chat)).toBe("hello world");
    expect(await chatSessions(chat)).toEqual([
      { id: SESSION, parentId: undefined, title: "hello world" },
    ]);
  });
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CHAT_FILE_NAME, CHATS_FOLDER_NAME } from "../../constants";
import { ChatIdSchema } from "../../schemas/chat-id";
import { logFileName, marksFileName } from "../records/file-names";
import { type LogRecord, type MarkRecord, recordLine } from "../records/record";
import {
  assistantMessage,
  at,
  DEVICE_A,
  header,
  messageId,
  messageRecord,
  partId,
  partRecord,
  sessionId,
  textPart,
  userMessage,
} from "../records/test-records";
import { ensureChatFolder, renameChatFolder } from "./chat-folder";
import { sweepChatFolders } from "./sweep";

/**
 * The sweep is what gives a workspace that was converted at the update a
 * folder for every chat it already had, so what is under test is that every
 * chat gets one, that running it again writes nothing, and that a folder the
 * person moved or deleted is not followed.
 */

const ZONE = "America/New_York";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "chat-folders-"));
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

function chatsDir() {
  return path.join(root, ".instrument", "chats");
}

function chatsFolder() {
  return path.join(root, CHATS_FOLDER_NAME);
}

/** A chat on disk: one session, a question, an answer and a settled title. */
async function writeChat(
  id: string,
  { title, words = "A question." }: { title?: string; words?: string } = {},
) {
  const chatId = ChatIdSchema.parse(id);
  const session = sessionId(1);
  const dir = path.join(chatsDir(), chatId);
  await fs.mkdir(dir, { recursive: true });
  const write = (name: string, records: (LogRecord | MarkRecord)[]) =>
    fs.writeFile(path.join(dir, name), records.map(recordLine).join(""));
  await write(logFileName(session, DEVICE_A, 1), [
    { ...header(0, { device: DEVICE_A, id: session }), chat: chatId },
    messageRecord(1, userMessage(session, messageId(1), at(0))),
    partRecord(2, textPart(session, messageId(1), partId(1), words, at(0))),
    messageRecord(3, assistantMessage(session, messageId(2), at(30))),
    partRecord(
      4,
      textPart(session, messageId(2), partId(2), "An answer.", at(30)),
    ),
  ]);
  if (title !== undefined) {
    await write(marksFileName(DEVICE_A), [
      {
        t: "mark",
        seq: 0,
        at: at(60),
        device: DEVICE_A,
        field: "title",
        session,
        value: { settled: true, text: title },
      },
    ]);
  }
  return { chatId, dir };
}

function sweep() {
  return sweepChatFolders({
    chatsDir: chatsDir(),
    rootDir: root,
    timeZone: ZONE,
  });
}

async function folderNames() {
  try {
    return (await fs.readdir(chatsFolder())).toSorted();
  } catch {
    return [];
  }
}

async function settingsOf(dir: string) {
  return JSON.parse(
    await fs.readFile(path.join(dir, "settings.json"), "utf8"),
  ) as Record<string, unknown>;
}

describe("every chat gets a folder", () => {
  it("gives each chat a folder named for its title, with its transcript", async () => {
    const one = await writeChat("2026-10-14-dishwashers", {
      title: "Quiet dishwashers under $900",
    });
    const two = await writeChat("2026-10-15-taxes", { title: "Taxes: 2026" });
    const swept = await sweep();

    expect(swept.counts).toEqual({
      "already-there": 0,
      failed: 0,
      "no-conversation": 0,
      written: 2,
    });
    expect(swept.complete).toBe(true);
    expect(await folderNames()).toEqual([
      "Quiet dishwashers under $900",
      "Taxes 2026",
    ]);
    expect(
      await fs.readFile(
        path.join(chatsFolder(), "Taxes 2026", CHAT_FILE_NAME),
        "utf8",
      ),
    ).toContain(
      "[Open this chat in Instrument](instrument://chat/2026-10-15-taxes)",
    );
    expect((await settingsOf(one.dir)).folder).toBe(
      "Quiet dishwashers under $900",
    );
    expect((await settingsOf(two.dir)).folder).toBe("Taxes 2026");
  });

  it("names a chat whose title never settled", async () => {
    await writeChat("2026-10-14-unnamed");
    await sweep();
    expect(await folderNames()).toEqual(["Untitled chat"]);
  });

  it("numbers the second folder two chats would share", async () => {
    await writeChat("2026-10-14-one", { title: "Dinner" });
    await writeChat("2026-10-15-two", { title: "Dinner" });
    await sweep();
    expect(await folderNames()).toEqual(["Dinner", "Dinner 2"]);
  });

  it("leaves no transcript for a record folder with no conversation", async () => {
    const dir = path.join(chatsDir(), "2026-10-14-empty");
    await fs.mkdir(dir, { recursive: true });
    const swept = await sweep();
    expect(swept.counts["no-conversation"]).toBe(1);
    expect(await folderNames()).toEqual([]);
  });

  it("writes nothing on a second run", async () => {
    await writeChat("2026-10-14-dishwashers", { title: "Dishwashers" });
    await sweep();
    const written = await fs.stat(
      path.join(chatsFolder(), "Dishwashers", CHAT_FILE_NAME),
    );
    const again = await sweep();
    expect(again.counts).toEqual({
      "already-there": 1,
      failed: 0,
      "no-conversation": 0,
      written: 0,
    });
    expect(
      (await fs.stat(path.join(chatsFolder(), "Dishwashers", CHAT_FILE_NAME)))
        .mtimeMs,
    ).toBe(written.mtimeMs);
  });

  it("renders the same bytes on a second run", async () => {
    await writeChat("2026-10-14-dishwashers", { title: "Dishwashers" });
    await sweep();
    const file = path.join(chatsFolder(), "Dishwashers", CHAT_FILE_NAME);
    const first = await fs.readFile(file);
    await fs.rm(file);
    await sweep();
    expect(await fs.readFile(file)).toEqual(first);
  });
});

describe("a gesture in a file manager", () => {
  it("makes a fresh folder for a chat whose folder was deleted", async () => {
    const { dir } = await writeChat("2026-10-14-dishwashers", {
      title: "Dishwashers",
    });
    await sweep();
    await fs.rm(path.join(chatsFolder(), "Dishwashers"), { recursive: true });
    const again = await sweep();
    expect(again.counts.written).toBe(1);
    expect(await folderNames()).toEqual(["Dishwashers"]);
    expect((await settingsOf(dir)).folder).toBe("Dishwashers");
  });

  it("does not follow a folder the person renamed", async () => {
    const { dir } = await writeChat("2026-10-14-dishwashers", {
      title: "Dishwashers",
    });
    await sweep();
    await fs.rename(
      path.join(chatsFolder(), "Dishwashers"),
      path.join(chatsFolder(), "My own notes"),
    );
    await sweep();
    expect(await folderNames()).toEqual(["Dishwashers", "My own notes"]);
    expect((await settingsOf(dir)).folder).toBe("Dishwashers");
  });
});

describe("the folder a chat is in", () => {
  it("keeps the folder its settings name", async () => {
    await fs.mkdir(path.join(chatsFolder(), "Dishwashers"), {
      recursive: true,
    });
    const folder = await ensureChatFolder({
      folder: "Dishwashers",
      rootDir: root,
      title: "Something else entirely",
    });
    expect(folder.name).toBe("Dishwashers");
  });

  it("renames the folder once the title settles", async () => {
    const made = await ensureChatFolder({
      folder: undefined,
      rootDir: root,
      title: "Find a quiet dishwasher",
    });
    await fs.writeFile(path.join(made.path, CHAT_FILE_NAME), "held");
    const renamed = await renameChatFolder({
      from: made.name,
      rootDir: root,
      title: "Quiet dishwashers under $900",
    });
    expect(renamed.name).toBe("Quiet dishwashers under $900");
    expect(await folderNames()).toEqual(["Quiet dishwashers under $900"]);
    expect(
      await fs.readFile(path.join(renamed.path, CHAT_FILE_NAME), "utf8"),
    ).toBe("held");
  });

  it("numbers a rename onto a name another folder holds", async () => {
    await fs.mkdir(path.join(chatsFolder(), "Dinner"), { recursive: true });
    const made = await ensureChatFolder({
      folder: undefined,
      rootDir: root,
      title: "Tonight",
    });
    const renamed = await renameChatFolder({
      from: made.name,
      rootDir: root,
      title: "Dinner",
    });
    expect(renamed.name).toBe("Dinner 2");
  });

  it("keeps the name it had when the folder is no longer there", async () => {
    const renamed = await renameChatFolder({
      from: "Gone",
      rootDir: root,
      title: "Dishwashers",
    });
    expect(renamed.name).toBe("Gone");
  });
});

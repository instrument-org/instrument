import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHAT_FILE_NAME, CHATS_FOLDER_NAME } from "../../constants";
import { ChatIdSchema } from "../../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
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
import { sweepChatFolders, writeChatFolder } from "./sweep";

/**
 * The sweep is what gives a workspace that was converted at the update a
 * folder for every chat it already had, so what is under test is that every
 * chat gets one, that running it again writes nothing, that a chat follows
 * the folder a person renamed, and that it follows nothing it would have to
 * guess at.
 */

const ZONE = "America/New_York";

let root: string;

const heldConfig = getWorkspaceConfig();

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "chat-folders-"));
  // A workspace the person picked, which is what makes its top level
  // theirs: what they sent moves into the chat's folder only where the
  // agent may read it there.
  setWorkspaceConfig({
    ...heldConfig,
    outputDir: AbsolutePathSchema.parse(root),
    rootDir: WorkspaceDirSchema.parse(root),
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  setWorkspaceConfig(heldConfig);
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

/** Renames a folder under `Chats/`, the way a person does in a file manager. */
function renameFolder(from: string, to: string) {
  return fs.rename(
    path.join(chatsFolder(), from),
    path.join(chatsFolder(), to),
  );
}

/** Copies one, the way a sync engine leaves a conflict or a backup a restore. */
function copyFolder(from: string, to: string) {
  return fs.cp(path.join(chatsFolder(), from), path.join(chatsFolder(), to), {
    recursive: true,
  });
}

/**
 * Watches for the transcripts a run opens looking for the chat a folder
 * names, and answers with the folder each was in. A chat's own transcript is
 * read whole to compare it, so an `open` of one is the look inside a folder
 * no chat claims and nothing else.
 */
function transcriptsOpened() {
  const open = vi.spyOn(fs, "open");
  return () =>
    open.mock.calls
      .map(([file]) => String(file))
      .filter((file) => file.endsWith(CHAT_FILE_NAME))
      .map((file) => path.basename(path.dirname(file)));
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
      "Quiet dishwashers under 900",
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
      "Quiet dishwashers under 900",
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

  it("deletes a sync engine's copy of a transcript it is not rewriting", async () => {
    await writeChat("2026-10-14-dishwashers", { title: "Dishwashers" });
    await sweep();
    const folder = path.join(chatsFolder(), "Dishwashers");
    const file = path.join(folder, CHAT_FILE_NAME);
    await fs.copyFile(file, path.join(folder, "CHAT 2.md"));
    await fs.writeFile(path.join(folder, "CHAT-notes.md"), "Mine.\n");

    const again = await sweep();

    expect(again.counts["already-there"]).toBe(1);
    expect((await fs.readdir(folder)).toSorted()).toEqual([
      "CHAT-notes.md",
      CHAT_FILE_NAME,
    ]);
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

  it("follows a folder the person renamed", async () => {
    const { dir } = await writeChat("2026-10-14-dishwashers", {
      title: "Dishwashers",
    });
    await sweep();
    await renameFolder("Dishwashers", "My own notes");
    const opened = transcriptsOpened();
    const again = await sweep();
    expect(again.counts.written).toBe(1);
    expect(await folderNames()).toEqual(["My own notes"]);
    expect((await settingsOf(dir)).folder).toBe("My own notes");
    expect(
      await fs.readFile(
        path.join(chatsFolder(), "My own notes", CHAT_FILE_NAME),
        "utf8",
      ),
    ).toContain(
      "[Open this chat in Instrument](instrument://chat/2026-10-14-dishwashers)",
    );
    // The one folder no chat claims, and no other.
    expect(opened()).toMatchInlineSnapshot(`
      [
        "My own notes",
      ]
    `);
  });

  it("follows a folder whose transcript names its chat in the link alone", async () => {
    const { dir } = await writeChat("2026-10-14-dishwashers", {
      title: "Dishwashers",
    });
    await sweep();
    await renameFolder("Dishwashers", "My own notes");
    // A folder written before the front matter named the chat, which is
    // every one the update made.
    const file = path.join(chatsFolder(), "My own notes", CHAT_FILE_NAME);
    const held = await fs.readFile(file, "utf8");
    await fs.writeFile(file, held.replace(/^chat: .*\n/m, ""), "utf8");

    await sweep();

    expect(await folderNames()).toEqual(["My own notes"]);
    expect((await settingsOf(dir)).folder).toBe("My own notes");
  });

  it("writes one chat's transcript on its own, as the end of its turn does", async () => {
    await writeChat("2026-10-14-dishwashers", { title: "Dishwashers" });
    await writeChat("2026-10-15-taxes", { title: "Taxes" });

    const written = await writeChatFolder({
      chatsDir: chatsDir(),
      id: ChatIdSchema.parse("2026-10-14-dishwashers"),
      rootDir: root,
      timeZone: ZONE,
    });

    // Only the chat whose turn ended; the other is the next sweep's.
    expect(written).toEqual({ folder: "Dishwashers", kind: "written" });
    expect(await folderNames()).toEqual(["Dishwashers"]);
  });

  it("writes nothing for a turn that left the transcript reading the same", async () => {
    await writeChat("2026-10-14-dishwashers", { title: "Dishwashers" });
    const once = {
      chatsDir: chatsDir(),
      id: ChatIdSchema.parse("2026-10-14-dishwashers"),
      rootDir: root,
      timeZone: ZONE,
    };
    await writeChatFolder(once);

    expect(await writeChatFolder(once)).toEqual({ kind: "already-there" });
  });

  it("brings what the person sent out of the record folder and into theirs", async () => {
    const { dir } = await writeChat("2026-10-14-dishwashers", {
      title: "Dishwashers",
    });
    await fs.mkdir(path.join(dir, "attachments"), { recursive: true });
    await fs.writeFile(path.join(dir, "attachments", "spec.pdf"), "a pdf");

    await sweep();

    await expect(
      fs.readFile(
        path.join(chatsFolder(), "Dishwashers", "attachments", "spec.pdf"),
        "utf8",
      ),
    ).resolves.toBe("a pdf");
    // Gone from where it was, so there is one copy rather than two.
    await expect(fs.readdir(path.join(dir, "attachments"))).rejects.toThrow();
  });

  it("leaves an attachments folder the person already made alone", async () => {
    const { dir } = await writeChat("2026-10-14-dishwashers", {
      title: "Dishwashers",
    });
    await sweep();
    const theirs = path.join(chatsFolder(), "Dishwashers", "attachments");
    await fs.mkdir(theirs, { recursive: true });
    await fs.writeFile(path.join(theirs, "mine.txt"), "the person's own");
    await fs.mkdir(path.join(dir, "attachments"), { recursive: true });
    await fs.writeFile(path.join(dir, "attachments", "spec.pdf"), "a pdf");

    await sweep();

    // Never merged over: a second run cannot overwrite what they put there.
    await expect(
      fs.readFile(path.join(theirs, "mine.txt"), "utf8"),
    ).resolves.toBe("the person's own");
    await expect(
      fs.readFile(path.join(dir, "attachments", "spec.pdf"), "utf8"),
    ).resolves.toBe("a pdf");
  });

  it("opens no transcript at all where nothing was renamed", async () => {
    await writeChat("2026-10-14-dishwashers", { title: "Dishwashers" });
    await writeChat("2026-10-15-taxes", { title: "Taxes" });
    await sweep();
    const opened = transcriptsOpened();
    await sweep();
    expect(opened()).toEqual([]);
  });

  it("leaves a copy alone while the chat's own folder is there", async () => {
    const { dir } = await writeChat("2026-10-14-dishwashers", {
      title: "Dishwashers",
    });
    await sweep();
    await copyFolder("Dishwashers", "Dishwashers, my copy");
    const opened = transcriptsOpened();
    const again = await sweep();
    expect(again.counts["already-there"]).toBe(1);
    expect(await folderNames()).toEqual([
      "Dishwashers",
      "Dishwashers, my copy",
    ]);
    expect((await settingsOf(dir)).folder).toBe("Dishwashers");
    expect(opened()).toEqual([]);
  });

  it("follows neither of two folders naming the same chat", async () => {
    const { dir } = await writeChat("2026-10-14-dishwashers", {
      title: "Dishwashers",
    });
    await sweep();
    await renameFolder("Dishwashers", "My own notes");
    await copyFolder("My own notes", "My own notes (conflict)");
    await sweep();
    expect(await folderNames()).toEqual([
      "Dishwashers",
      "My own notes",
      "My own notes (conflict)",
    ]);
    expect((await settingsOf(dir)).folder).toBe("Dishwashers");
  });

  it.each([
    [
      "holds no transcript",
      (folder: string) => fs.rm(path.join(folder, CHAT_FILE_NAME)),
    ],
    [
      "holds a transcript with no link in it",
      (folder: string) =>
        fs.writeFile(
          path.join(folder, CHAT_FILE_NAME),
          "My own notes about dishwashers.\n",
        ),
    ],
  ])("makes a fresh folder where the renamed one %s", async (_what, change) => {
    const { dir } = await writeChat("2026-10-14-dishwashers", {
      title: "Dishwashers",
    });
    await sweep();
    await renameFolder("Dishwashers", "My own notes");
    await change(path.join(chatsFolder(), "My own notes"));
    await sweep();
    expect(await folderNames()).toEqual(["Dishwashers", "My own notes"]);
    expect((await settingsOf(dir)).folder).toBe("Dishwashers");
  });

  it("leaves a folder naming a chat this workspace does not have", async () => {
    const { dir } = await writeChat("2026-10-14-dishwashers", {
      title: "Dishwashers",
    });
    await sweep();
    await fs.rm(path.join(chatsFolder(), "Dishwashers"), { recursive: true });
    const elsewhere = path.join(chatsFolder(), "From another computer");
    await fs.mkdir(elsewhere, { recursive: true });
    await fs.writeFile(
      path.join(elsewhere, CHAT_FILE_NAME),
      "[Open this chat in Instrument](instrument://chat/2026-01-01-elsewhere)\n",
    );
    await sweep();
    expect(await folderNames()).toEqual([
      "Dishwashers",
      "From another computer",
    ]);
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
    expect(renamed.name).toBe("Quiet dishwashers under 900");
    expect(await folderNames()).toEqual(["Quiet dishwashers under 900"]);
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

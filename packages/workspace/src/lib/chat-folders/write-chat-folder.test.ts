import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHAT_FILE_NAME, CHATS_FOLDER_NAME } from "../../constants";
import { ChatIdSchema } from "../../schemas/chat-id";
import {
  AbsolutePathSchema,
  ChatDirSchema,
  WorkspaceDirSchema,
} from "../../schemas/paths";
import { chatAttachmentsDir } from "../chat-dir-utils";
import { chatOwnFolder } from "../record-folders";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { logFileName, settingsFileName } from "../records/file-names";
import {
  type LogRecord,
  type SettingRecord,
  recordLine,
} from "../records/record";
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
import { giveChatsTheirFolders } from "./first-folders";
import { chatFolderNames, findChatFolderNames } from "./own-folder";
import { attachmentsWaitingToMove, writeChatFolder } from "./write-chat-folder";

/**
 * A chat's folder is written one chat at a time, at the moments something
 * happened to that chat, so what is under test is that the chat gets its
 * folder, that writing it again writes nothing, that a chat follows the
 * folder a person renamed, and that it follows nothing it would have to
 * guess at.
 */

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
    workspaceMachineDir: AbsolutePathSchema.parse(machineDir()),
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
  const write = (name: string, records: (LogRecord | SettingRecord)[]) =>
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
    await write(settingsFileName(DEVICE_A), [
      {
        t: "set",
        seq: 0,
        at: at(60),
        device: DEVICE_A,
        field: "title",
        session,
        value: { auto: false, text: title },
      },
    ]);
  }
  return { chatId, dir };
}

function machineDir() {
  return path.join(root, "machine");
}

/** Writes one chat's folder, as the end of its turn or a message sent does. */
function writeFolder(id: string) {
  return writeChatFolder({
    chatsDir: chatsDir(),
    id: ChatIdSchema.parse(id),
    machineDir: machineDir(),
    rootDir: root,
  });
}

async function folderNames() {
  try {
    return (await fs.readdir(chatsFolder())).toSorted();
  } catch {
    return [];
  }
}

/** The name this computer recorded for the folder of the chat in `dir`. */
function folderOf(dir: string) {
  return chatFolderNames(machineDir()).get(path.basename(dir));
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
 * Watches for the transcripts a write opens looking for the chat a folder
 * names, and answers with the folder each was in. A chat's own transcript is
 * read whole to compare it, so an `openSync` of one is the look inside a
 * folder no chat claims and nothing else.
 */
function transcriptsOpened() {
  const openSync = vi.spyOn(fsSync, "openSync");
  const open = vi.spyOn(fsSync.promises, "open");
  return () =>
    [...openSync.mock.calls, ...open.mock.calls]
      .map(([file]) => String(file))
      .filter((file) => file.endsWith(CHAT_FILE_NAME))
      .map((file) => path.basename(path.dirname(file)));
}

describe("a chat's folder", () => {
  it("gives a chat a folder named for its title, with its transcript", async () => {
    const one = await writeChat("2026-10-14-dishwashers", {
      title: "Quiet dishwashers under $900",
    });
    const two = await writeChat("2026-10-15-taxes", { title: "Taxes: 2026" });

    expect(await writeFolder("2026-10-14-dishwashers")).toEqual({
      folder: "Quiet dishwashers under 900",
      kind: "written",
    });
    await writeFolder("2026-10-15-taxes");

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
    expect(folderOf(one.dir)).toBe("Quiet dishwashers under 900");
    expect(folderOf(two.dir)).toBe("Taxes 2026");
  });

  it("writes only the chat it is asked for", async () => {
    await writeChat("2026-10-14-dishwashers", { title: "Dishwashers" });
    await writeChat("2026-10-15-taxes", { title: "Taxes" });

    await writeFolder("2026-10-14-dishwashers");

    expect(await folderNames()).toEqual(["Dishwashers"]);
  });

  it("names a chat the agent never named by its opening words", async () => {
    await writeChat("2026-10-14-unnamed");
    await writeFolder("2026-10-14-unnamed");
    expect(await folderNames()).toEqual(["A question"]);
  });

  it("numbers the second folder two chats would share", async () => {
    await writeChat("2026-10-14-one", { title: "Dinner" });
    await writeChat("2026-10-15-two", { title: "Dinner" });
    await writeFolder("2026-10-14-one");
    await writeFolder("2026-10-15-two");
    expect(await folderNames()).toEqual(["Dinner", "Dinner 2"]);
  });

  it("leaves no transcript for a record folder with no conversation", async () => {
    await fs.mkdir(path.join(chatsDir(), "2026-10-14-empty"), {
      recursive: true,
    });
    expect(await writeFolder("2026-10-14-empty")).toEqual({
      kind: "no-conversation",
    });
    expect(await folderNames()).toEqual([]);
  });

  it("writes nothing when the transcript already reads the same", async () => {
    await writeChat("2026-10-14-dishwashers", { title: "Dishwashers" });
    await writeFolder("2026-10-14-dishwashers");
    const file = path.join(chatsFolder(), "Dishwashers", CHAT_FILE_NAME);
    const written = await fs.stat(file);

    expect(await writeFolder("2026-10-14-dishwashers")).toEqual({
      kind: "already-there",
    });
    expect((await fs.stat(file)).mtimeMs).toBe(written.mtimeMs);
  });

  it("deletes a sync engine's copy of a transcript it is not rewriting", async () => {
    await writeChat("2026-10-14-dishwashers", { title: "Dishwashers" });
    await writeFolder("2026-10-14-dishwashers");
    const folder = path.join(chatsFolder(), "Dishwashers");
    const file = path.join(folder, CHAT_FILE_NAME);
    await fs.copyFile(file, path.join(folder, "CHAT 2.md"));
    await fs.writeFile(path.join(folder, "CHAT-notes.md"), "Mine.\n");

    expect(await writeFolder("2026-10-14-dishwashers")).toEqual({
      kind: "already-there",
    });
    expect((await fs.readdir(folder)).toSorted()).toEqual([
      "CHAT-notes.md",
      CHAT_FILE_NAME,
    ]);
  });

  it("renders the same bytes each time", async () => {
    await writeChat("2026-10-14-dishwashers", { title: "Dishwashers" });
    await writeFolder("2026-10-14-dishwashers");
    const file = path.join(chatsFolder(), "Dishwashers", CHAT_FILE_NAME);
    const first = await fs.readFile(file);
    await fs.rm(file);
    await writeFolder("2026-10-14-dishwashers");
    expect(await fs.readFile(file)).toEqual(first);
  });

  it("brings what the person sent out of the record folder and into theirs", async () => {
    const { dir } = await writeChat("2026-10-14-dishwashers", {
      title: "Dishwashers",
    });
    await fs.mkdir(path.join(dir, "attachments"), { recursive: true });
    await fs.writeFile(path.join(dir, "attachments", "spec.pdf"), "a pdf");

    await writeFolder("2026-10-14-dishwashers");

    await expect(
      fs.readFile(
        path.join(chatsFolder(), "Dishwashers", "attachments", "spec.pdf"),
        "utf8",
      ),
    ).resolves.toBe("a pdf");
    // Gone from where it was, so there is one copy rather than two.
    await expect(fs.readdir(path.join(dir, "attachments"))).rejects.toThrow();
  });

  it("brings older uploads in beside newer ones already in the chat's folder", async () => {
    const { chatId, dir } = await writeChat("2026-10-14-dishwashers", {
      title: "Dishwashers",
    });
    await writeFolder("2026-10-14-dishwashers");
    // Sent before the chat had its folder, and after.
    await fs.mkdir(path.join(dir, "attachments"), { recursive: true });
    await fs.writeFile(path.join(dir, "attachments", "spec.pdf"), "a pdf");
    const theirs = path.join(chatsFolder(), "Dishwashers", "attachments");
    await fs.mkdir(theirs, { recursive: true });
    await fs.writeFile(path.join(theirs, "photo.jpg"), "a photo");
    expect(await attachmentsWaitingToMove(chatId)).toBe(true);

    await writeFolder("2026-10-14-dishwashers");

    expect((await fs.readdir(theirs)).toSorted()).toEqual([
      "photo.jpg",
      "spec.pdf",
    ]);
    await expect(fs.readdir(path.join(dir, "attachments"))).rejects.toThrow();
    expect(await attachmentsWaitingToMove(chatId)).toBe(false);
    expect(chatAttachmentsDir(ChatDirSchema.parse(dir))).toBe(theirs);
  });

  it("never writes over a file of the same name in the chat's folder", async () => {
    const { dir } = await writeChat("2026-10-14-dishwashers", {
      title: "Dishwashers",
    });
    await writeFolder("2026-10-14-dishwashers");
    const theirs = path.join(chatsFolder(), "Dishwashers", "attachments");
    await fs.mkdir(theirs, { recursive: true });
    await fs.writeFile(path.join(theirs, "spec.pdf"), "the person's own");
    await fs.mkdir(path.join(dir, "attachments"), { recursive: true });
    await fs.writeFile(path.join(dir, "attachments", "spec.pdf"), "a pdf");
    await fs.writeFile(path.join(dir, "attachments", "notes.md"), "notes");

    await writeFolder("2026-10-14-dishwashers");

    // Both kept: theirs where it was, the upload left in the record folder.
    await expect(
      fs.readFile(path.join(theirs, "spec.pdf"), "utf8"),
    ).resolves.toBe("the person's own");
    await expect(
      fs.readFile(path.join(dir, "attachments", "spec.pdf"), "utf8"),
    ).resolves.toBe("a pdf");
    await expect(
      fs.readFile(path.join(theirs, "notes.md"), "utf8"),
    ).resolves.toBe("notes");
  });
});

describe("a gesture in a file manager", () => {
  it("makes a fresh folder for a chat whose folder was deleted", async () => {
    const { dir } = await writeChat("2026-10-14-dishwashers", {
      title: "Dishwashers",
    });
    await writeFolder("2026-10-14-dishwashers");
    await fs.rm(path.join(chatsFolder(), "Dishwashers"), { recursive: true });
    expect((await writeFolder("2026-10-14-dishwashers")).kind).toBe("written");
    expect(await folderNames()).toEqual(["Dishwashers"]);
    expect(folderOf(dir)).toBe("Dishwashers");
  });

  it("follows a folder the person renamed, in the shell at once and in the record at the next write", async () => {
    const { dir } = await writeChat("2026-10-14-dishwashers", {
      title: "Dishwashers",
    });
    await writeFolder("2026-10-14-dishwashers");
    await renameFolder("Dishwashers", "My own notes");

    // The shell finds it before the turn ends, so the turn's work lands there.
    expect(chatOwnFolder(dir)).toBe(path.join(chatsFolder(), "My own notes"));

    const opened = transcriptsOpened();
    expect(await writeFolder("2026-10-14-dishwashers")).toEqual({
      folder: "My own notes",
      kind: "written",
    });
    expect(await folderNames()).toEqual(["My own notes"]);
    expect(folderOf(dir)).toBe("My own notes");
    expect(
      await fs.readFile(
        path.join(chatsFolder(), "My own notes", CHAT_FILE_NAME),
        "utf8",
      ),
    ).toContain(
      "[Open this chat in Instrument](instrument://chat/2026-10-14-dishwashers)",
    );
    // The one folder no chat claims, and no other.
    expect(opened()).toEqual(["My own notes"]);
  });

  it("takes the folder another computer made for a chat this one has no name for", async () => {
    const { dir } = await writeChat("2026-10-14-dishwashers", {
      title: "Dishwashers",
    });
    await writeFolder("2026-10-14-dishwashers");
    await fs.rm(machineDir(), { force: true, recursive: true });
    await renameFolder("Dishwashers", "Named elsewhere");

    await writeFolder("2026-10-14-dishwashers");

    expect(await folderNames()).toEqual(["Named elsewhere"]);
    expect(folderOf(dir)).toBe("Named elsewhere");
  });

  it("records the folder the shell finds, so the next ask goes by its name", async () => {
    const { dir } = await writeChat("2026-10-14-dishwashers", {
      title: "Dishwashers",
    });
    await writeFolder("2026-10-14-dishwashers");
    await fs.rm(machineDir(), { force: true, recursive: true });
    await renameFolder("Dishwashers", "Named elsewhere");

    expect(chatOwnFolder(dir)).toBe(
      path.join(chatsFolder(), "Named elsewhere"),
    );
    await vi.waitFor(() => {
      expect(folderOf(dir)).toBe("Named elsewhere");
    });
    const opened = transcriptsOpened();
    expect(chatOwnFolder(dir)).toBe(
      path.join(chatsFolder(), "Named elsewhere"),
    );
    expect(opened()).toEqual([]);
  });

  it.runIf(process.platform === "darwin")(
    "passes over a transcript kept in the cloud only when the shell asks",
    async () => {
      const { dir } = await writeChat("2026-10-14-dishwashers", {
        title: "Dishwashers",
      });
      await writeFolder("2026-10-14-dishwashers");
      await fs.rm(machineDir(), { force: true, recursive: true });
      await renameFolder("Dishwashers", "Named elsewhere");
      const fstat = fsSync.fstatSync;
      // Contents and no blocks on disk: a file only in the cloud.
      vi.spyOn(fsSync, "fstatSync").mockImplementation((handle) =>
        Object.assign(fstat(handle), { blocks: 0 }),
      );
      const read = vi.spyOn(fsSync, "readSync");

      expect(chatOwnFolder(dir)).toBeUndefined();
      expect(read).not.toHaveBeenCalled();
    },
  );

  it("records at launch each chat's one folder this computer has no name for", async () => {
    const one = await writeChat("2026-10-14-dishwashers", {
      title: "Dishwashers",
    });
    const two = await writeChat("2026-10-15-taxes", { title: "Taxes" });
    const three = await writeChat("2026-10-16-garden", { title: "Garden" });
    await writeFolder("2026-10-14-dishwashers");
    await writeFolder("2026-10-15-taxes");
    await writeFolder("2026-10-16-garden");
    await fs.rm(machineDir(), { force: true, recursive: true });
    await renameFolder("Dishwashers", "Named elsewhere");
    // Two folders naming one chat: which is its own is the person's to say.
    await copyFolder("Taxes", "Taxes, my copy");

    expect(
      await findChatFolderNames({
        chats: chatsFolder(),
        // The garden chat is gone; its folder stays the person's.
        isChat: (id) => id !== three.chatId,
        machineDir: machineDir(),
      }),
    ).toBe(1);
    expect(folderOf(one.dir)).toBe("Named elsewhere");
    expect(folderOf(two.dir)).toBeUndefined();
    expect(folderOf(three.dir)).toBeUndefined();
  });

  it("follows a folder whose transcript names its chat in the link alone", async () => {
    const { dir } = await writeChat("2026-10-14-dishwashers", {
      title: "Dishwashers",
    });
    await writeFolder("2026-10-14-dishwashers");
    await renameFolder("Dishwashers", "My own notes");
    // A folder written before the front matter named the chat.
    const file = path.join(chatsFolder(), "My own notes", CHAT_FILE_NAME);
    const held = await fs.readFile(file, "utf8");
    await fs.writeFile(file, held.replace(/^chat: .*\n/m, ""), "utf8");

    await writeFolder("2026-10-14-dishwashers");

    expect(await folderNames()).toEqual(["My own notes"]);
    expect(folderOf(dir)).toBe("My own notes");
  });

  it("opens no other transcript while the chat's own folder is there", async () => {
    await writeChat("2026-10-14-dishwashers", { title: "Dishwashers" });
    await writeFolder("2026-10-14-dishwashers");
    await copyFolder("Dishwashers", "Dishwashers, my copy");
    const opened = transcriptsOpened();

    expect(await writeFolder("2026-10-14-dishwashers")).toEqual({
      kind: "already-there",
    });
    expect(await folderNames()).toEqual([
      "Dishwashers",
      "Dishwashers, my copy",
    ]);
    expect(opened()).toEqual([]);
  });

  it("follows neither of two folders naming the same chat", async () => {
    const { dir } = await writeChat("2026-10-14-dishwashers", {
      title: "Dishwashers",
    });
    await writeFolder("2026-10-14-dishwashers");
    await renameFolder("Dishwashers", "My own notes");
    await copyFolder("My own notes", "My own notes (conflict)");

    await writeFolder("2026-10-14-dishwashers");

    expect(await folderNames()).toEqual([
      "Dishwashers",
      "My own notes",
      "My own notes (conflict)",
    ]);
    expect(folderOf(dir)).toBe("Dishwashers");
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
    await writeFolder("2026-10-14-dishwashers");
    await renameFolder("Dishwashers", "My own notes");
    await change(path.join(chatsFolder(), "My own notes"));
    await writeFolder("2026-10-14-dishwashers");
    expect(await folderNames()).toEqual(["Dishwashers", "My own notes"]);
    expect(folderOf(dir)).toBe("Dishwashers");
  });

  it("leaves a folder naming another chat", async () => {
    const { dir } = await writeChat("2026-10-14-dishwashers", {
      title: "Dishwashers",
    });
    await writeFolder("2026-10-14-dishwashers");
    await fs.rm(path.join(chatsFolder(), "Dishwashers"), { recursive: true });
    const elsewhere = path.join(chatsFolder(), "From another computer");
    await fs.mkdir(elsewhere, { recursive: true });
    await fs.writeFile(
      path.join(elsewhere, CHAT_FILE_NAME),
      "[Open this chat in Instrument](instrument://chat/2026-01-01-elsewhere)\n",
    );
    await writeFolder("2026-10-14-dishwashers");
    expect(await folderNames()).toEqual([
      "Dishwashers",
      "From another computer",
    ]);
    expect(folderOf(dir)).toBe("Dishwashers");
  });
});

describe("the chats a launch just converted", () => {
  it("writes the folders of the chats it is given and reads no other", async () => {
    await writeChat("2026-10-14-dishwashers", { title: "Dishwashers" });
    await writeChat("2026-10-15-taxes", { title: "Taxes" });

    const written = await giveChatsTheirFolders(root, machineDir(), [
      "2026-10-15-taxes",
    ]);

    expect(written).toEqual([
      { folder: "Taxes", id: "2026-10-15-taxes", kind: "written" },
    ]);
    expect(await folderNames()).toEqual(["Taxes"]);
  });

  it("touches nothing at a launch that converted no chat", async () => {
    await writeChat("2026-10-14-dishwashers", { title: "Dishwashers" });
    const read = vi.spyOn(fs, "readdir");

    expect(await giveChatsTheirFolders(root, machineDir(), [])).toEqual([]);
    expect(read).not.toHaveBeenCalled();
    expect(await folderNames()).toEqual([]);
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

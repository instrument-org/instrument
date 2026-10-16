import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CHAT_FILE_NAME } from "../../constants";
import { ChatIdSchema } from "../../schemas/chat-id";
import {
  deleteChatFileConflictCopies,
  isChatFileConflictCopy,
} from "./conflict-copies";

/**
 * A copy of `CHAT.md` a sync engine left is garbage: the transcript is
 * rendered from the records and read back as nothing. What is under test is
 * that each engine's naming is recognized, and that the files beside it
 * survive: the transcript itself, a transcript of another chat, and a file
 * the person happened to name close to one.
 */

const CHAT = ChatIdSchema.parse("2026-10-16-dishwashers");
const OTHER = ChatIdSchema.parse("2026-10-16-taxes");

/** A transcript's head, which is where the chat it belongs to is named. */
function transcript(id: string) {
  return `---\nchat: ${id}\nstarted: 2026-10-16\n---\n\n[Open this chat in Instrument](instrument://chat/${id})\n`;
}

describe("the name a sync engine gives its copy", () => {
  it.each([
    ["iCloud Drive", "CHAT 2.md"],
    ["iCloud Drive, a third version", "CHAT 3.md"],
    ["Dropbox", "CHAT (Jeremy's conflicted copy 2026-10-16).md"],
    ["Dropbox, by case", "CHAT (Case Conflict).md"],
    ["OneDrive", "CHAT-JEREMY-PC.md"],
    ["OneDrive, a Mac's name", "CHAT-Jeremy's MacBook Pro.md"],
    ["Syncthing", "CHAT.sync-conflict-20261016-120000-ABCD123.md"],
    [
      "Syncthing, a copy of a copy",
      "CHAT.sync-conflict-20261016-120000-ABCD123.sync-conflict-20261017-090000-EFGH456.md",
    ],
    ["two engines", "CHAT 2-JEREMY-PC.md"],
  ])("is read as one from %s", (_engine, name) => {
    expect(isChatFileConflictCopy(name)).toBe(true);
  });

  it.each([
    CHAT_FILE_NAME,
    `.~${CHAT_FILE_NAME}.tmp`,
    `.${CHAT_FILE_NAME}.icloud`,
    "CHATS.md",
    "CHAT notes.md",
    "chat 2.md",
    "CHAT 2.txt",
    "handoff-notes.md",
  ])("is not what %s is", (name) => {
    expect(isChatFileConflictCopy(name)).toBe(false);
  });

  // Every entry of the folder is read at the end of every turn, and a sync
  // engine writes whatever names it likes into it. A name of many of the
  // segments a copied name carries used to take minutes to refuse, four
  // times as long for every two more (file-names.ts).
  it("refuses a name of many copy segments at once", () => {
    const name = `CHAT${"-a".repeat(120)}.txt`;
    const started = performance.now();

    expect(isChatFileConflictCopy(name)).toBe(false);

    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe("a copy of a chat's transcript", () => {
  let folder: string;

  beforeEach(async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), "conflict-copies-"));
  });

  afterEach(async () => {
    await fs.rm(folder, { force: true, recursive: true });
  });

  async function write(name: string, text: string) {
    await fs.writeFile(path.join(folder, name), text);
  }

  async function names() {
    return (await fs.readdir(folder)).toSorted();
  }

  it("goes, whichever engine left it, and the transcript stays", async () => {
    await write(CHAT_FILE_NAME, transcript(CHAT));
    await write("CHAT 2.md", transcript(CHAT));
    await write(
      "CHAT (Jeremy's conflicted copy 2026-10-16).md",
      transcript(CHAT),
    );
    await write("CHAT-JEREMY-PC.md", transcript(CHAT));
    await write(
      "CHAT.sync-conflict-20261016-120000-ABCD123.md",
      transcript(CHAT),
    );

    expect(await deleteChatFileConflictCopies({ folder, id: CHAT }))
      .toMatchInlineSnapshot(`
      [
        "CHAT (Jeremy's conflicted copy 2026-10-16).md",
        "CHAT 2.md",
        "CHAT-JEREMY-PC.md",
        "CHAT.sync-conflict-20261016-120000-ABCD123.md",
      ]
    `);
    expect(await names()).toEqual([CHAT_FILE_NAME]);
  });

  it("is a file of the person's until it says it is ours", async () => {
    await write(CHAT_FILE_NAME, transcript(CHAT));
    // What OneDrive's copy and a person's own notes both look like.
    await write("CHAT-notes.md", "# Things to ask about the quiet one\n");
    await write("CHAT 2.md", "My own second take on this.\n");

    expect(await deleteChatFileConflictCopies({ folder, id: CHAT })).toEqual(
      [],
    );
    expect(await names()).toEqual([
      "CHAT 2.md",
      "CHAT-notes.md",
      CHAT_FILE_NAME,
    ]);
  });

  it("stays when it is another chat's transcript", async () => {
    await write(CHAT_FILE_NAME, transcript(CHAT));
    await write("CHAT 2.md", transcript(OTHER));

    expect(await deleteChatFileConflictCopies({ folder, id: CHAT })).toEqual(
      [],
    );
    expect(await names()).toEqual(["CHAT 2.md", CHAT_FILE_NAME]);
  });

  it("is nothing to do where the chat has no folder yet", async () => {
    expect(
      await deleteChatFileConflictCopies({
        folder: path.join(folder, "not there"),
        id: CHAT,
      }),
    ).toEqual([]);
  });
});

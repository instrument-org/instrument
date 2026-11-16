import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { DeviceIdSchema } from "../records/device-id";
import { workspaceLayout } from "../workspace-layout";
import { readChatFolderMoves } from "./folder-moves";
import { retireChatsFolder } from "./retire-chats-folder";

const CHAT = ChatIdSchema.parse("2026-10-16-dishwashers");
const OTHER = ChatIdSchema.parse("2026-10-16-taxes");
const DEVICE = DeviceIdSchema.parse("dev_7Q2M4K9X");

let root: string;
let rootDir: string;
let filesDir: string;
let machineDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "retire-chats-"));
  rootDir = path.join(root, "workspace");
  filesDir = path.join(rootDir, "Files");
  machineDir = path.join(root, "machine");
  fs.mkdirSync(machineDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { force: true, recursive: true });
});

function transcript(id: string) {
  return `---\ntitle: Quiet dishwashers\nchat: instrument://chat/${id}\n---\n\n[Open this chat in Instrument](instrument://chat/${id})\n`;
}

/** Writes files under the workspace, by their paths from its top level. */
function write(files: Record<string, string>) {
  for (const [at, text] of Object.entries(files)) {
    const file = path.join(rootDir, at);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}

/** Every file under the workspace, by its path from the top level, records' logs aside. */
function tree(): string[] {
  return (fs.readdirSync(rootDir, { recursive: true }) as string[])
    .filter((at) => fs.statSync(path.join(rootDir, at)).isFile())
    .map((at) => at.split(path.sep).join("/"))
    .toSorted();
}

function records(id: string) {
  fs.mkdirSync(path.join(workspaceLayout(rootDir).chatsDir, id), {
    recursive: true,
  });
}

function retire() {
  return retireChatsFolder({ device: DEVICE, filesDir, machineDir, rootDir });
}

describe("retireChatsFolder", () => {
  it("deletes a folder that holds only its transcript, and Chats/ with it", async () => {
    write({
      "Chats/Quiet dishwashers/.DS_Store": "",
      "Chats/Quiet dishwashers/CHAT.md": transcript(CHAT),
    });

    expect(await retire()).toEqual({
      deleted: 1,
      left: [],
      moved: 0,
      returned: 0,
    });
    expect(fs.existsSync(path.join(rootDir, "Chats"))).toBe(false);
    expect(tree()).toEqual([]);
  });

  it("deletes the sync engines' copies of the transcript", async () => {
    write({
      "Chats/Quiet dishwashers/CHAT 2.md": transcript(CHAT),
      "Chats/Quiet dishwashers/CHAT-notes.md": "# My own notes\n",
      "Chats/Quiet dishwashers/CHAT.md": transcript(CHAT),
    });

    expect((await retire()).moved).toBe(1);
    expect(tree()).toEqual([
      ".instrument/devices/dev_7Q2M4K9X/chatfoldermoves.jsonl",
      "Files/Quiet dishwashers/CHAT-notes.md",
    ]);
  });

  it("moves a folder with files into Files/ and records where it went", async () => {
    write({
      "Chats/Quiet dishwashers/CHAT.md": transcript(CHAT),
      "Chats/Quiet dishwashers/report/.env": "KEY=1",
      "Chats/Quiet dishwashers/shortlist.csv": "brand,dB",
    });

    expect(await retire()).toEqual({
      deleted: 0,
      left: [],
      moved: 1,
      returned: 0,
    });
    expect(tree()).toMatchInlineSnapshot(`
      [
        ".instrument/devices/dev_7Q2M4K9X/chatfoldermoves.jsonl",
        "Files/Quiet dishwashers/report/.env",
        "Files/Quiet dishwashers/shortlist.csv",
      ]
    `);
    expect(
      await readChatFolderMoves(workspaceLayout(rootDir).devicesDir),
    ).toEqual(
      new Map([
        [
          "Quiet dishwashers",
          { chat: CHAT, from: "Quiet dishwashers", to: "Quiet dishwashers" },
        ],
      ]),
    );
  });

  it("puts attachments and handoff notes back in the chat's records", async () => {
    records(CHAT);
    write({
      [`.instrument/chats/${CHAT}/attachments/taken.png`]: "kept",
      "Chats/Quiet dishwashers/CHAT.md": transcript(CHAT),
      "Chats/Quiet dishwashers/attachments/manual.pdf": "pdf",
      "Chats/Quiet dishwashers/attachments/taken.png": "theirs",
      "Chats/Quiet dishwashers/handoff-notes.md": "notes",
    });

    expect(await retire()).toMatchObject({ moved: 1, returned: 2 });
    expect(tree()).toMatchInlineSnapshot(`
      [
        ".instrument/chats/2026-10-16-dishwashers/attachments/manual.pdf",
        ".instrument/chats/2026-10-16-dishwashers/attachments/taken.png",
        ".instrument/chats/2026-10-16-dishwashers/handoff-notes.md",
        ".instrument/devices/dev_7Q2M4K9X/chatfoldermoves.jsonl",
        "Files/Quiet dishwashers/attachments/taken.png",
      ]
    `);
  });

  it("finds the chat in this computer's names file where the transcript is gone", async () => {
    records(OTHER);
    fs.writeFileSync(
      path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.chatFolders),
      JSON.stringify({ [OTHER]: "Taxes" }),
    );
    write({ "Chats/Taxes/attachments/w2.pdf": "pdf" });

    expect(await retire()).toMatchObject({ deleted: 1, returned: 1 });
    expect(tree()).toEqual([`.instrument/chats/${OTHER}/attachments/w2.pdf`]);
    expect(
      fs.existsSync(
        path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.chatFolders),
      ),
    ).toBe(false);
  });

  it("merges into a Files/ folder of the same name, numbering a taken file", async () => {
    write({
      "Chats/Quiet dishwashers/CHAT.md": transcript(CHAT),
      "Chats/Quiet dishwashers/notes.md": "from the chat",
      "Chats/Quiet dishwashers/photos/a.jpg": "a",
      "Files/Quiet dishwashers/notes.md": "already there",
      "Files/Quiet dishwashers/notes 2.md": "also there",
      "Files/Quiet dishwashers/photos/b.jpg": "b",
    });

    expect((await retire()).moved).toBe(1);
    expect(tree()).toMatchInlineSnapshot(`
      [
        ".instrument/devices/dev_7Q2M4K9X/chatfoldermoves.jsonl",
        "Files/Quiet dishwashers/notes 2.md",
        "Files/Quiet dishwashers/notes 3.md",
        "Files/Quiet dishwashers/notes.md",
        "Files/Quiet dishwashers/photos/a.jpg",
        "Files/Quiet dishwashers/photos/b.jpg",
      ]
    `);
    expect(
      fs.readFileSync(
        path.join(filesDir, "Quiet dishwashers", "notes 3.md"),
        "utf8",
      ),
    ).toBe("from the chat");
  });

  it("changes nothing on a second run", async () => {
    records(CHAT);
    write({
      "Chats/Empty/CHAT.md": transcript(OTHER),
      "Chats/Quiet dishwashers/CHAT.md": transcript(CHAT),
      "Chats/Quiet dishwashers/attachments/manual.pdf": "pdf",
      "Chats/Quiet dishwashers/shortlist.csv": "brand,dB",
    });
    await retire();
    const after = tree();

    expect(await retire()).toEqual({
      deleted: 0,
      left: [],
      moved: 0,
      returned: 0,
    });
    expect(tree()).toEqual(after);
  });
});

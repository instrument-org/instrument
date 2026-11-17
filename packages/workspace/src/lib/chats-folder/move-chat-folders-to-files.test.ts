import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { DeviceIdSchema } from "../records/device-id";
import { workspaceLayout } from "../workspace-layout";
import { readChatFolderMoves } from "./folder-moves";
import { moveChatFoldersToFiles } from "./move-chat-folders-to-files";

const CHAT = ChatIdSchema.parse("2026-10-16-dishwashers");
const OTHER = ChatIdSchema.parse("2026-10-16-taxes");
const DEVICE = DeviceIdSchema.parse("dev_7Q2M4K9X");

let root: string;
let rootDir: string;
let filesDir: string;
let machineDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "move-chat-folders-"));
  rootDir = path.join(root, "workspace");
  filesDir = path.join(rootDir, "Files");
  machineDir = path.join(root, "machine");
  fs.mkdirSync(machineDir, { recursive: true });
});

afterEach(() => {
  for (const at of locked.splice(0)) {
    fs.chmodSync(at, 0o755);
  }
  fs.rmSync(root, { force: true, recursive: true });
});

/** Folders made unwritable or unreadable, opened again before cleanup. */
const locked: string[] = [];

function lock(at: string, mode: number) {
  const full = path.join(rootDir, at);
  fs.chmodSync(full, mode);
  locked.push(full);
}

function names(owners: Record<string, string>) {
  fs.writeFileSync(
    path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.chatFolders),
    JSON.stringify(owners),
  );
}

function hasNames() {
  return fs.existsSync(
    path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.chatFolders),
  );
}

async function moves() {
  return Object.fromEntries(
    await readChatFolderMoves(workspaceLayout(rootDir).devicesDir),
  );
}

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

function moveChatFolders() {
  return moveChatFoldersToFiles({
    device: DEVICE,
    filesDir,
    machineDir,
    rootDir,
  });
}

describe("moveChatFoldersToFiles", () => {
  it("deletes a folder that holds only its transcript, and Chats/ with it", async () => {
    records(CHAT);
    write({
      "Chats/Quiet dishwashers/.DS_Store": "",
      "Chats/Quiet dishwashers/CHAT.md": transcript(CHAT),
    });

    expect(await moveChatFolders()).toEqual({
      deleted: 1,
      left: [],
      moved: 0,
      returned: 0,
    });
    expect(fs.existsSync(path.join(rootDir, "Chats"))).toBe(false);
    expect(tree()).toEqual([]);
  });

  it("deletes the sync engines' copies of the transcript", async () => {
    records(CHAT);
    write({
      "Chats/Quiet dishwashers/CHAT 2.md": transcript(CHAT),
      "Chats/Quiet dishwashers/CHAT-notes.md": "# My own notes\n",
      "Chats/Quiet dishwashers/CHAT.md": transcript(CHAT),
    });

    expect((await moveChatFolders()).moved).toBe(1);
    expect(tree()).toEqual([
      ".instrument/devices/dev_7Q2M4K9X/chatfoldermoves.jsonl",
      "Files/Quiet dishwashers/CHAT-notes.md",
    ]);
  });

  it("moves a folder with files into Files/ and records where it went", async () => {
    records(CHAT);
    write({
      "Chats/Quiet dishwashers/CHAT.md": transcript(CHAT),
      "Chats/Quiet dishwashers/report/.env": "KEY=1",
      "Chats/Quiet dishwashers/shortlist.csv": "brand,dB",
    });

    expect(await moveChatFolders()).toEqual({
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

    expect(await moveChatFolders()).toMatchObject({ moved: 1, returned: 2 });
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

    expect(await moveChatFolders()).toMatchObject({ deleted: 1, returned: 1 });
    expect(tree()).toEqual([`.instrument/chats/${OTHER}/attachments/w2.pdf`]);
    expect(
      fs.existsSync(
        path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.chatFolders),
      ),
    ).toBe(false);
  });

  it.each([
    ["a folder", "Files/Quiet dishwashers/notes.md"],
    ["a file", "Files/Quiet dishwashers"],
  ])(
    "moves the folder whole under a numbered name where %s in Files/ has its name",
    async (_label, taken) => {
      records(CHAT);
      write({
        "Chats/Quiet dishwashers/CHAT.md": transcript(CHAT),
        "Chats/Quiet dishwashers/notes.md": "from the chat",
        "Files/Quiet dishwashers 2/notes.md": "also there",
        [taken]: "already there",
      });

      expect((await moveChatFolders()).moved).toBe(1);
      expect(
        fs.readFileSync(
          path.join(filesDir, "Quiet dishwashers 3", "notes.md"),
          "utf8",
        ),
      ).toBe("from the chat");
      expect(await moves()).toEqual({
        "Quiet dishwashers": {
          chat: CHAT,
          from: "Quiet dishwashers",
          to: "Quiet dishwashers 3",
        },
      });
    },
  );

  it.each([
    [
      "a folder whose CHAT.md names no chat",
      { "Chats/Recipes/CHAT.md": "# Chat with Grandma\n" },
    ],
    ["a folder with no CHAT.md", { "Chats/Recipes/soup.md": "soup" }],
  ])("leaves a Chats/ the person made whole: %s", async (_label, files) => {
    write({ ...files, "Chats/loose.txt": "mine" });
    const before = tree();

    expect(await moveChatFolders()).toEqual({
      deleted: 0,
      left: [],
      moved: 0,
      returned: 0,
    });
    expect(tree()).toEqual(before);
  });

  it("leaves a folder that is no chat's beside one that is, and keeps the names file", async () => {
    records(CHAT);
    names({ [CHAT]: "Quiet dishwashers" });
    write({
      "Chats/Quiet dishwashers/shortlist.csv": "brand,dB",
      "Chats/Recipes/CHAT.md": "# Chat with Grandma\n",
      "Chats/Recipes/soup.md": "soup",
    });

    expect(await moveChatFolders()).toMatchObject({ left: [], moved: 1 });
    expect(tree()).toMatchInlineSnapshot(`
      [
        ".instrument/devices/dev_7Q2M4K9X/chatfoldermoves.jsonl",
        "Chats/Recipes/CHAT.md",
        "Chats/Recipes/soup.md",
        "Files/Quiet dishwashers/shortlist.csv",
      ]
    `);
    expect(hasNames()).toBe(true);
  });

  it("keeps a deleted chat's transcript with the rest of its folder", async () => {
    write({
      "Chats/Quiet dishwashers/CHAT.md": transcript(CHAT),
      "Chats/Quiet dishwashers/attachments/manual.pdf": "pdf",
    });

    expect(await moveChatFolders()).toMatchObject({ moved: 1, returned: 0 });
    expect(tree()).toMatchInlineSnapshot(`
      [
        ".instrument/devices/dev_7Q2M4K9X/chatfoldermoves.jsonl",
        "Files/Quiet dishwashers/CHAT.md",
        "Files/Quiet dishwashers/attachments/manual.pdf",
      ]
    `);
  });

  // Windows has no mode that makes a file or folder unreadable.
  it.skipIf(process.platform === "win32")(
    "waits on a folder whose CHAT.md cannot be read",
    async () => {
      records(CHAT);
      names({ [CHAT]: "Quiet dishwashers" });
      write({
        "Chats/Quiet dishwashers/CHAT.md": transcript(CHAT),
        "Chats/Quiet dishwashers/attachments/manual.pdf": "pdf",
      });
      lock("Chats/Quiet dishwashers/CHAT.md", 0o000);
      const before = tree();

      const moved = await moveChatFolders();

      expect(moved.left.map(({ where }) => path.relative(rootDir, where)))
        .toMatchInlineSnapshot(`
      [
        "Chats/Quiet dishwashers",
      ]
    `);
      expect(moved).toMatchObject({ moved: 0, returned: 0 });
      expect(tree()).toEqual(before);
      expect(hasNames()).toBe(true);
    },
  );

  // Windows has no mode that makes a file or folder unreadable.
  it.skipIf(process.platform === "win32")(
    "keeps the names file when Chats/ cannot be listed",
    async () => {
      names({ [CHAT]: "Quiet dishwashers" });
      write({ "Chats/Quiet dishwashers/notes.md": "notes" });
      lock("Chats", 0o000);

      const moved = await moveChatFolders();

      expect(moved.left.map(({ where }) => path.relative(rootDir, where)))
        .toMatchInlineSnapshot(`
      [
        "Chats",
      ]
    `);
      expect(hasNames()).toBe(true);
    },
  );

  // Windows has no mode that makes a folder unwritable.
  it.skipIf(process.platform === "win32").each([
    [
      "its move is refused",
      // Nothing in it can move, as when another program holds it.
      () => lock("Chats/A held folder", 0o555),
      `.instrument/chats/${CHAT}/attachments/manual.pdf`,
    ],
    [
      "putting back what the person sent throws",
      () => lock(`.instrument/chats/${CHAT}`, 0o555),
      "Chats/A held folder/attachments/manual.pdf",
    ],
  ])(
    "goes on to the next folder when one cannot be emptied: %s",
    async (_label, hold, sent) => {
      records(CHAT);
      records(OTHER);
      write({
        "Chats/A held folder/CHAT.md": transcript(CHAT),
        "Chats/A held folder/attachments/manual.pdf": "pdf",
        "Chats/A held folder/notes.md": "held",
        "Chats/Taxes/CHAT.md": transcript(OTHER),
        "Chats/Taxes/w2.pdf": "pdf",
      });
      hold();

      const moved = await moveChatFolders();

      expect(
        moved.left.map(({ where }) => path.relative(rootDir, where)),
      ).toEqual(["Chats/A held folder"]);
      expect(moved.moved).toBe(1);
      expect(tree()).toEqual(
        [
          ".instrument/devices/dev_7Q2M4K9X/chatfoldermoves.jsonl",
          "Chats/A held folder/CHAT.md",
          "Chats/A held folder/notes.md",
          "Files/Taxes/w2.pdf",
          sent,
        ].toSorted(),
      );
      expect(Object.keys(await moves())).toEqual(["Taxes"]);
    },
  );

  it("changes nothing on a second run", async () => {
    records(CHAT);
    write({
      "Chats/Empty/CHAT.md": transcript(OTHER),
      "Chats/Quiet dishwashers/CHAT.md": transcript(CHAT),
      "Chats/Quiet dishwashers/attachments/manual.pdf": "pdf",
      "Chats/Quiet dishwashers/shortlist.csv": "brand,dB",
    });
    await moveChatFolders();
    const after = tree();

    expect(await moveChatFolders()).toEqual({
      deleted: 0,
      left: [],
      moved: 0,
      returned: 0,
    });
    expect(tree()).toEqual(after);
  });
});

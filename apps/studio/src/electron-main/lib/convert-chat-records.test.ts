import {
  CHAT_DB_FILE_NAME,
  type ChatConversion,
  type convertWorkspaceChats,
  newDeviceId,
} from "@instrument-org/workspace/electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

import { convertChatRecords } from "./convert-chat-records";
import {
  readWorkspaceIdentity,
  WORKSPACE_FORMAT_VERSION,
  writeWorkspaceIdentity,
} from "./workspaces";

/**
 * The launch step over a workspace's chats: what it sets aside, what it
 * marks, and what it leaves for the next launch.
 *
 * The conversion itself is the workspace package's
 * (`records/convert/convert-chat.test.ts`), and it is handed in here rather
 * than run: what each outcome means to the app is the thing under test, and
 * a folder built to produce one outcome pins how the conversion classifies
 * folders as a side effect, which is how the database of a chat whose records
 * came from another computer came to be moved out of the workspace with
 * nothing compared.
 */

let rootDir: string;
let machineDir: string;

const DEVICE = newDeviceId();

beforeEach(() => {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "convert-chat-records-")),
  );
  rootDir = path.join(dir, "Workspace");
  machineDir = path.join(dir, "machine");
  writeWorkspaceIdentity(rootDir, {
    color: "gray",
    createdBy: { kind: "person" },
    formatVersion: 1,
    name: "Mine",
    settingsVersion: 2,
  });
});

afterEach(() => {
  said.clear();
  fs.rmSync(path.dirname(rootDir), { force: true, recursive: true });
});

const chatsDir = () => path.join(rootDir, ".instrument", "chats");

const run = () =>
  convertChatRecords({
    appVersion: "0.0.0-test",
    convert: conversionThatSays,
    deviceId: DEVICE,
    machineDir,
    rootDir,
  });

/**
 * A chat's records and the `chat.db` beside them, for the launch to set
 * aside. Its sidecars too, where `withSidecars` asks for them.
 */
function seedChat(id: string, { withSidecars = false } = {}) {
  const dir = path.join(chatsDir(), id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `marks.${DEVICE}.jsonl`), "");
  fs.writeFileSync(path.join(dir, "chat.db"), `${id}'s database`);
  if (withSidecars) {
    fs.writeFileSync(path.join(dir, "chat.db-wal"), "a write-ahead log");
    fs.writeFileSync(path.join(dir, "chat.db-shm"), "shared memory");
  }
  return dir;
}

/** What the conversion says about each chat it was handed, by folder name. */
const said = new Map<string, ChatConversion>();

/** The databases a chat folder holds, as the conversion reports them. */
function storeOf(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(CHAT_DB_FILE_NAME))
    .toSorted()
    .map((name) => path.join(dir, name));
}

/**
 * A conversion that reports what `said` holds for each folder, defaulting to
 * a chat that converted whole, which is what most of these tests are about.
 */
const conversionThatSays: typeof convertWorkspaceChats = (dir) => {
  const chats = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const where = path.join(dir, entry.name);
      const converted: ChatConversion = {
        converted: {
          blobBytes: 0,
          blobs: 0,
          leftBehind: {},
          logBytes: 0,
          messages: 1,
          parts: 1,
          sessions: 1,
          swept: 0,
        },
        kind: "converted",
        store: storeOf(where),
      };
      const outcome = said.get(entry.name) ?? converted;
      return { ...outcome, dir: where };
    });
  const counts = {
    converted: 0,
    different: 0,
    failed: 0,
    "half-written": 0,
    "already-converted": 0,
    "no-store": 0,
    unreadable: 0,
  };
  for (const chat of chats) {
    counts[chat.kind] += 1;
  }
  return Promise.resolve({
    chats,
    complete:
      counts.different +
        counts.failed +
        counts["half-written"] +
        counts.unreadable ===
      0,
    counts,
  });
};

/** Every file under `dir`, by its path from there. */
function tree(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .toSorted();
}

const asideDir = () => path.join(machineDir, "set-aside", "chat-db");

it("marks a workspace with no chats folder, which has no chat to convert", async () => {
  const converted = await run();

  expect(converted.left).toEqual([]);
  const identity = readWorkspaceIdentity(rootDir);
  expect(identity.chatRecordsConverted).toBe(true);
  expect(identity.formatVersion).toBe(WORKSPACE_FORMAT_VERSION);
});

it("sets every converted chat's database aside and marks the workspace", async () => {
  seedChat("red-and-blue-squares", { withSidecars: true });
  seedChat("a-trip-to-lisbon");

  const converted = await run();

  expect(converted.left).toEqual([]);
  expect(tree(asideDir())).toEqual([
    "a-trip-to-lisbon.db",
    "red-and-blue-squares.db",
    "red-and-blue-squares.db-shm",
    "red-and-blue-squares.db-wal",
  ]);
  expect(
    fs.readFileSync(path.join(asideDir(), "a-trip-to-lisbon.db"), "utf8"),
  ).toBe("a-trip-to-lisbon's database");
  // Out of the workspace, which may be in a synced folder.
  expect(tree(chatsDir())).toEqual([
    path.join("a-trip-to-lisbon", `marks.${DEVICE}.jsonl`),
    path.join("red-and-blue-squares", `marks.${DEVICE}.jsonl`),
  ]);
  const identity = readWorkspaceIdentity(rootDir);
  expect(identity.chatRecordsConverted).toBe(true);
  expect(identity.formatVersion).toBe(WORKSPACE_FORMAT_VERSION);
});

it("is a no-op on the next launch", async () => {
  seedChat("red-and-blue-squares");
  await run();
  const aside = tree(asideDir());
  const chats = tree(chatsDir());
  const identity = readWorkspaceIdentity(rootDir);
  // Its database is gone, so the next launch finds the chat already on its
  // records with nothing left to move.
  said.set("red-and-blue-squares", { kind: "already-converted", store: [] });

  const again = await run();

  expect(again.left).toEqual([]);
  expect(again.done).toHaveLength(1);
  expect(again.done[0]).toMatch(
    /^converted 0 chat\(s\) and found 1 already on their records, in \d+ms$/,
  );
  expect(tree(asideDir())).toEqual(aside);
  expect(tree(chatsDir())).toEqual(chats);
  expect(readWorkspaceIdentity(rootDir)).toEqual(identity);
});

it("keeps the chat it could not convert, says why, and marks nothing", async () => {
  seedChat("red-and-blue-squares");
  // No conversion reads a folder that is not named by a chat id.
  const broken = path.join(chatsDir(), "not a chat id at all");
  fs.mkdirSync(broken, { recursive: true });
  fs.writeFileSync(path.join(broken, "chat.db"), "a database");
  said.set("not a chat id at all", {
    error: "not a chat id at all is not a chat id",
    kind: "failed",
  });

  const converted = await run();

  expect(converted.left.map(({ where }) => where)).toEqual([
    "not a chat id at all",
  ]);
  expect(converted.left[0]?.reason).toContain("is not a chat id");
  // The chat that converted is done, and the one that did not keeps its
  // database, so the next launch tries that one alone.
  expect(tree(asideDir())).toEqual(["red-and-blue-squares.db"]);
  expect(fs.existsSync(path.join(broken, "chat.db"))).toBe(true);
  const identity = readWorkspaceIdentity(rootDir);
  expect(identity.chatRecordsConverted).toBeUndefined();
  expect(identity.formatVersion).toBe(1);

  said.set("red-and-blue-squares", { kind: "already-converted", store: [] });
  const again = await run();

  expect(again.left).toHaveLength(1);
  expect(tree(asideDir())).toEqual(["red-and-blue-squares.db"]);
});

it("marks the workspace once the last chat converts", async () => {
  const broken = path.join(chatsDir(), "not a chat id at all");
  fs.mkdirSync(broken, { recursive: true });
  fs.writeFileSync(path.join(broken, "chat.db"), "a database");
  said.set("not a chat id at all", {
    error: "not a chat id at all is not a chat id",
    kind: "failed",
  });
  await run();
  expect(readWorkspaceIdentity(rootDir).formatVersion).toBe(1);

  fs.rmSync(broken, { force: true, recursive: true });
  const converted = await run();

  expect(converted.left).toEqual([]);
  const identity = readWorkspaceIdentity(rootDir);
  expect(identity.chatRecordsConverted).toBe(true);
  expect(identity.formatVersion).toBe(WORKSPACE_FORMAT_VERSION);
});

it("leaves a converted chat's database in the workspace when it cannot be moved", async () => {
  const dir = seedChat("red-and-blue-squares");
  // The place its database would go, taken by a folder of that name.
  fs.mkdirSync(path.join(asideDir(), "red-and-blue-squares.db", "in the way"), {
    recursive: true,
  });

  const converted = await run();

  expect(converted.done.join("\n")).toContain("left it there");
  expect(fs.existsSync(path.join(dir, "chat.db"))).toBe(true);
  // The chat is on its records either way, so the workspace is marked and
  // the next launch moves the database.
  expect(readWorkspaceIdentity(rootDir).chatRecordsConverted).toBe(true);
});

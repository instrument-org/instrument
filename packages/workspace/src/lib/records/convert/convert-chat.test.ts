import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import superjson from "superjson";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { type ChatId } from "../../../schemas/chat-id";
import { SessionMessage } from "../../../schemas/session/message";
import { SessionMessagePart } from "../../../schemas/session/message-part";
import { withTempDir } from "../../../test/helpers/temp-dir";
import { disposeSessionsStoreStorage } from "../../session-store-storage";
import { StorageKey } from "../../storage-key";
import { blobPath } from "../blobs";
import { ChatRecords, installChatRecords } from "../chat-records";
import {
  logFileName,
  settingsFileName,
  parseRecordFileName,
} from "../file-names";
import { foldChat, type FoldedChat, type FoldedSession } from "../fold";
import { partFromRecord } from "../part-blobs";
import { readLog } from "../read-records";
import type { DeviceId } from "../device-id";
import * as recordModule from "../record";
import {
  assistantMessage,
  at,
  DEVICE_A,
  DEVICE_B,
  messageId,
  partId,
  sessionId,
  userMessage,
} from "../test-records";
import { convertChat, convertWorkspaceChats } from "./convert-chat";
import { readChatDb } from "./read-chat-db";
import {
  CHAT_SESSION,
  EVERY_KIND_SESSION,
  INTERRUPTED,
  OLDER_SESSION,
  part,
  saveMessage,
  saveSession,
  TASK_SESSION,
  tell,
  writeChat,
  writeEveryKindChat,
  writeOlderThanSchemasChat,
  writeUntitledChat,
} from "./test-chats";

const root = withTempDir("records-convert");

afterEach(() => {
  vi.restoreAllMocks();
});

const OPTIONS = { app: "0.0.0-test", deviceId: DEVICE_A };

function chatPath(name: string): string {
  return path.join(root.path, "chats", name);
}

/** What converting `writeEveryKindChat` leaves in the chat's folder. */
const EVERY_KIND_FILES = [
  "blobs/sha256-98bb5e791a5eda35b5facb9385bb19cc6692108c537da7b87f5dccbe5c9716d9.pdf",
  "blobs/sha256-a694d888a1b59b444944827ef314d864d2bb445ac852f1fcd4939c4e835a460f.png",
  "chat.db",
  "ses_01K7A000000000000000000001.dev_AAAAAAAA.jsonl",
  "ses_01K7A000000000000000000002.dev_AAAAAAAA.jsonl",
  "settings.dev_AAAAAAAA.jsonl",
];

/** Every file under `dir`, by its path from there. */
async function listing(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path
        .relative(dir, path.join(entry.parentPath, entry.name))
        .replaceAll("\\", "/"),
    )
    .toSorted();
}

/** Every file under `dir` with its bytes and when it last changed. */
async function contents(dir: string) {
  const files: Record<string, { bytes: Buffer; mtimeMs: number }> = {};
  for (const name of await listing(dir)) {
    const file = path.join(dir, name);
    files[name] = {
      bytes: await fs.readFile(file),
      mtimeMs: (await fs.stat(file)).mtimeMs,
    };
  }
  return files;
}

async function foldFolder(dir: string): Promise<FoldedChat> {
  const files: { bytes: Uint8Array; name: string }[] = [];
  for (const name of (await fs.readdir(dir)).toSorted()) {
    if (parseRecordFileName(name)) {
      files.push({ bytes: await fs.readFile(path.join(dir, name)), name });
    }
  }
  return foldChat(files);
}

/** A folded session's messages with their blobs read back into the parts. */
function readBack(dir: string, session: FoldedSession) {
  return Promise.all(
    session.messages.map(async (message) => ({
      ...message,
      parts: await Promise.all(
        message.parts.map((one) =>
          partFromRecord(one, (name) => fs.readFile(blobPath(dir, name))),
        ),
      ),
    })),
  );
}

/** Makes every rename to a path `to` matches fail, as a disk that went away would. */
function failRenamesTo(to: RegExp): void {
  const rename = fs.rename;
  vi.spyOn(fs, "rename").mockImplementation((from, target) =>
    to.test(String(target))
      ? Promise.reject(new Error("The disk went away"))
      : rename(from, target),
  );
}

const PartLineSchema = z.object({ part: z.unknown(), t: z.literal("part") });

/** The part each of a log's part lines holds, as its bytes have it. */
async function partLines(file: string): Promise<unknown[]> {
  const text = await fs.readFile(file, "utf8");
  return text
    .split("\n")
    .filter((line) => line !== "")
    .flatMap((line) => {
      const parsed = PartLineSchema.safeParse(JSON.parse(line) as unknown);
      return parsed.success ? [parsed.data.part] : [];
    });
}

/**
 * Makes the converter write each part as reading it gave, which is what
 * loses a payload no schema here reads.
 */
function writeReadParts(): void {
  const line = recordModule.recordLine;
  vi.spyOn(recordModule, "recordLine").mockImplementation((record) =>
    line(
      record.t === "part"
        ? { ...record, part: SessionMessagePart.coerce(record.part) }
        : record,
    ),
  );
}

/**
 * What is under `dir` but its `chat.db`: each record file as its text with
 * the chat's own id taken out, since two chats differ by the id every log
 * header carries, and each blob as its bytes.
 */
async function recordFiles(dir: string): Promise<Record<string, string>> {
  const chat = path.basename(dir);
  const files: Record<string, string> = {};
  for (const name of await listing(dir)) {
    if (name === "chat.db") {
      continue;
    }
    const read = await fs.readFile(path.join(dir, name));
    files[name] = name.endsWith(".jsonl")
      ? read.toString("utf8").replaceAll(`"${chat}"`, '"<chat>"')
      : read.toString("base64");
  }
  return files;
}

/**
 * Writes records into the chat's own folder beside the `chat.db` already
 * there: the folder a conversion cut off partway leaves, the folder a build
 * that wrote records beside the store left, and, under another `device`, the
 * folder a second computer's records sync into.
 */
async function alongsideTheStore(
  dir: string,
  chat: ChatId,
  write: (records: ChatRecords) => Promise<void>,
  device: DeviceId = DEVICE_A,
): Promise<void> {
  const records = new ChatRecords({
    app: "0.0.0-test",
    device,
    dirOf: () => dir,
    fsync: false,
  });
  installChatRecords(records);
  try {
    await write(records);
  } finally {
    installChatRecords(undefined);
    await records.dispose();
    await disposeSessionsStoreStorage(chat);
  }
}

/**
 * A chat holding a tool output no record can carry, which the comparison
 * finds and no run ever converts.
 */
function writeHoldsAMapChat(dir: string): Promise<ChatId> {
  const s = sessionId(1);
  return writeChat(dir, async (chat) => {
    await saveSession(chat, { createdAt: at(0), id: s, title: "Maps" });
    await saveMessage(chat, assistantMessage(s, messageId(1), at(1)), [
      part(s, messageId(1), 10, {
        input: { command: "count" },
        output: new Map([["words", 3]]),
        state: "output-available",
        toolCallId: "call-10",
        type: "tool-bash",
      }),
    ]);
  });
}

/** Each record a log holds, by kind, a part by its type. */
async function recordKinds(file: string): Promise<string[]> {
  const read = readLog(await fs.readFile(file));
  if (read.kind !== "read") {
    return [read.reason];
  }
  return read.records.map(({ record }) => {
    switch (record.t) {
      case "part":
        return `part ${record.part.type}`;
      case "state":
        return `state ${record.what}`;
      default:
        return record.t;
    }
  });
}

describe("convertChat", () => {
  it("converts every kind of record, which reads back as the store reads it", async () => {
    // Frozen, so the call left waiting is finished at the same moment by the
    // read below and by the conversion, and the two compare exactly.
    vi.useFakeTimers({ now: at(500), toFake: ["Date"] });
    const dir = chatPath("every-kind");
    const chat = await writeEveryKindChat(dir);
    await disposeSessionsStoreStorage(chat);
    // What the store held, through the reader the conversion itself uses:
    // each session's own messages with their parts.
    const read = await readChatDb(
      path.join(dir, "chat.db"),
      path.join(root.path, "read-back"),
    );
    if (read.kind !== "read") {
      throw new Error(`chat.db is unreadable: ${read.error}`);
    }
    const stored = new Map(
      read.sessions.map((session) => [
        session.session.id,
        session.messages.map(({ message, parts }) => ({
          ...message,
          parts: parts.map((held) => held.part),
        })),
      ]),
    );
    const db = await fs.readFile(path.join(dir, "chat.db"));

    const result = await convertChat(dir, OPTIONS);

    expect(result.kind).toBe("converted");
    const { logBytes, ...converted } =
      result.kind === "converted" ? result.converted : { logBytes: 0 };
    expect(logBytes).toBeGreaterThan(0);
    expect(converted).toMatchInlineSnapshot(`
      {
        "blobBytes": 29,
        "blobs": 2,
        "leftBehind": {},
        "messages": 8,
        "parts": 22,
        "sessions": 2,
        "swept": 1,
      }
    `);
    expect(await fs.readFile(path.join(dir, "chat.db"))).toEqual(db);
    expect(await listing(dir)).toEqual(EVERY_KIND_FILES);
    for (const session of [CHAT_SESSION, TASK_SESSION]) {
      const log = path.join(dir, logFileName(session, DEVICE_A));
      expect(await fs.readFile(log, "utf8")).not.toContain("base64Data");
    }
    expect(
      await recordKinds(path.join(dir, logFileName(CHAT_SESSION, DEVICE_A))),
    ).toMatchInlineSnapshot(`
      [
        "session",
        "message",
        "part text",
        "part data-attachments",
        "message",
        "part text",
        "message",
        "part step-start",
        "part reasoning",
        "part text",
        "part tool-bash",
        "part tool-bash",
        "part tool-read_file",
        "part tool-web_fetch",
        "part tool-read_file",
        "part tool-bash",
        "message",
        "part text",
        "part data-reply",
        "part data-modelChange",
        "part data-unknown",
        "message",
        "part text",
        "part data-contextRollover",
        "message",
        "part tool-bash",
        "rollover",
        "stopped",
        "state apps",
        "state browser",
        "state folders",
        "state memory",
        "state processes",
      ]
    `);
    expect(
      await recordKinds(path.join(dir, logFileName(TASK_SESSION, DEVICE_A))),
    ).toMatchInlineSnapshot(`
      [
        "session",
        "message",
        "part text",
        "message",
        "part tool-read_file",
        "part text",
        "stopped",
        "state folders",
      ]
    `);

    const folded = await foldFolder(dir);
    expect(
      folded.sessions.map(({ messages: _messages, ...session }) => session),
    ).toMatchInlineSnapshot(`
      [
        {
          "app": "0.0.0-test",
          "chat": "every-kind",
          "createdAt": 2026-10-14T12:00:00.000Z,
          "forked": false,
          "id": "ses_01K7A000000000000000000001",
          "rollover": {
            "after": "msg_01K7A000000000000000000005",
            "usableTokens": 120000,
          },
          "settings": {
            "archived": {
              "at": 2026-10-14T12:00:30.000Z,
              "device": "dev_AAAAAAAA",
              "field": "archived",
              "session": "ses_01K7A000000000000000000001",
              "t": "set",
              "value": true,
            },
            "starred": {
              "at": 2026-10-14T12:00:20.000Z,
              "device": "dev_AAAAAAAA",
              "field": "starred",
              "session": "ses_01K7A000000000000000000001",
              "t": "set",
              "value": true,
            },
            "title": {
              "at": 2026-10-14T12:00:10.000Z,
              "device": "dev_AAAAAAAA",
              "field": "title",
              "session": "ses_01K7A000000000000000000001",
              "t": "set",
              "value": {
                "auto": false,
                "text": "Plans for the trip",
              },
            },
            "topic": {
              "at": 2026-10-14T12:01:40.000Z,
              "device": "dev_AAAAAAAA",
              "field": "topic",
              "session": "ses_01K7A000000000000000000001",
              "t": "set",
              "value": "travel",
            },
            "unread": {
              "at": 2026-10-14T12:00:40.000Z,
              "device": "dev_AAAAAAAA",
              "field": "unread",
              "session": "ses_01K7A000000000000000000001",
              "t": "set",
              "value": "marked",
            },
          },
          "state": {
            "apps": {
              "gmail": {
                "connected": true,
                "name": "Gmail",
              },
            },
            "browser": {
              "lastUsedAt": "2026-10-14T12:01:10.000Z",
              "visitedHosts": [
                "example.com",
              ],
            },
            "folders": [
              {
                "path": "/Users/someone/Trips",
              },
            ],
            "memory": {
              "trips.md": "rev-1",
            },
            "processes": [
              {
                "command": "npm run dev",
                "id": "bg_1",
              },
            ],
          },
          "stopped": {
            "at": 2026-10-14T12:00:50.000Z,
            "by": "user",
          },
          "updatedAt": 2026-10-14T12:01:40.000Z,
          "writtenBy": Map {
            "msg_01K7A000000000000000000001" => "dev_AAAAAAAA",
            "prt_01K7A000000000000000000010" => "dev_AAAAAAAA",
            "prt_01K7A000000000000000000011" => "dev_AAAAAAAA",
            "msg_01K7A000000000000000000002" => "dev_AAAAAAAA",
            "prt_01K7A000000000000000000020" => "dev_AAAAAAAA",
            "msg_01K7A000000000000000000003" => "dev_AAAAAAAA",
            "prt_01K7A000000000000000000030" => "dev_AAAAAAAA",
            "prt_01K7A000000000000000000031" => "dev_AAAAAAAA",
            "prt_01K7A000000000000000000032" => "dev_AAAAAAAA",
            "prt_01K7A000000000000000000033" => "dev_AAAAAAAA",
            "prt_01K7A000000000000000000034" => "dev_AAAAAAAA",
            "prt_01K7A000000000000000000035" => "dev_AAAAAAAA",
            "prt_01K7A000000000000000000036" => "dev_AAAAAAAA",
            "prt_01K7A000000000000000000037" => "dev_AAAAAAAA",
            "prt_01K7A000000000000000000038" => "dev_AAAAAAAA",
            "msg_01K7A000000000000000000004" => "dev_AAAAAAAA",
            "prt_01K7A000000000000000000040" => "dev_AAAAAAAA",
            "prt_01K7A000000000000000000041" => "dev_AAAAAAAA",
            "prt_01K7A000000000000000000042" => "dev_AAAAAAAA",
            "prt_01K7A000000000000000000043" => "dev_AAAAAAAA",
            "msg_01K7A000000000000000000005" => "dev_AAAAAAAA",
            "prt_01K7A000000000000000000050" => "dev_AAAAAAAA",
            "prt_01K7A000000000000000000051" => "dev_AAAAAAAA",
            "msg_01K7A000000000000000000006" => "dev_AAAAAAAA",
            "prt_01K7A000000000000000000060" => "dev_AAAAAAAA",
          },
        },
        {
          "app": "0.0.0-test",
          "chat": "every-kind",
          "createdAt": 2026-10-14T12:01:00.000Z,
          "forked": false,
          "forkedAt": "msg_01K7A000000000000000000003",
          "handle": "t1",
          "id": "ses_01K7A000000000000000000002",
          "parent": "ses_01K7A000000000000000000001",
          "settings": {},
          "state": {
            "folders": [
              {
                "path": "/Users/someone/Trips",
              },
            ],
          },
          "stopped": {
            "at": 2026-10-14T12:01:30.000Z,
            "by": "user",
          },
          "title": "Find hotels",
          "updatedAt": 2026-10-14T12:01:30.000Z,
          "writtenBy": Map {
            "msg_01K7A000000000000000000007" => "dev_AAAAAAAA",
            "prt_01K7A000000000000000000070" => "dev_AAAAAAAA",
            "msg_01K7A000000000000000000008" => "dev_AAAAAAAA",
            "prt_01K7A000000000000000000080" => "dev_AAAAAAAA",
            "prt_01K7A000000000000000000085" => "dev_AAAAAAAA",
          },
        },
      ]
    `);
    for (const session of folded.sessions) {
      expect(await readBack(dir, session)).toEqual(stored.get(session.id));
    }
  });

  it.each([
    [["travel", "family"], "travel"],
    [[], undefined],
  ])(
    "files a chat whose row kept the topics %j under the first",
    async (topics, topic) => {
      const dir = chatPath(`topics-${topics.length}`);
      await writeChat(dir, async (chat) => {
        const { topic: _one, ...session } = EVERY_KIND_SESSION;
        await tell(chat, StorageKey.session(session.id), {
          ...session,
          topics,
        });
      });

      expect(await convertChat(dir, OPTIONS)).toMatchObject({
        kind: "converted",
      });
      const [chatSession] = (await foldFolder(dir)).sessions;
      expect(chatSession?.settings.topic?.value).toBe(topic);
    },
  );

  it("finishes a call a closed chat left waiting in the records, and not in chat.db", async () => {
    const dir = chatPath("waiting-call");
    await writeEveryKindChat(dir);
    const db = await fs.readFile(path.join(dir, "chat.db"));

    const result = await convertChat(dir, OPTIONS);

    expect(result).toMatchObject({
      converted: { swept: 1 },
      kind: "converted",
    });
    const [chatSession] = (await foldFolder(dir)).sessions;
    expect(chatSession?.messages.at(-1)?.parts[0]).toMatchObject(INTERRUPTED);
    expect(await fs.readFile(path.join(dir, "chat.db"))).toEqual(db);
    expect(await listing(dir)).toEqual(EVERY_KIND_FILES);
    const reader = new DatabaseSync(path.join(dir, "chat.db"), {
      readOnly: true,
    });
    const row = reader
      .prepare("select blob from sessions where key = ?")
      .get(StorageKey.part(CHAT_SESSION, messageId(6), partId(60)));
    reader.close();
    expect(superjson.parse(String(row?.blob))).toMatchObject({
      state: "input-available",
    });
  });

  it("writes a payload no schema here reads as the row held it, and reads it back as unknown", async () => {
    const dir = chatPath("older-than-its-schemas");
    await writeOlderThanSchemasChat(dir);

    const result = await convertChat(dir, OPTIONS);

    expect(result.kind).toBe("converted");
    const log = path.join(dir, logFileName(OLDER_SESSION, DEVICE_A));
    // Everything after the first message's text.
    expect((await partLines(log)).slice(1)).toMatchInlineSnapshot(`
      [
        {
          "data": {
            "handle": "t1",
            "title": "Find hotels",
          },
          "metadata": {
            "createdAt": "2026-10-14T12:03:40.000Z",
            "id": "prt_01K7A000000000000000000220",
            "messageId": "msg_01K7A000000000000000000022",
            "sessionId": "ses_01K7A000000000000000000020",
          },
          "type": "data-adoptedTask",
        },
        {
          "data": {
            "events": [
              {
                "status": "done",
                "summary": "Three hotels",
                "title": "Find hotels",
              },
            ],
          },
          "metadata": {
            "createdAt": "2026-10-14T12:03:41.000Z",
            "id": "prt_01K7A000000000000000000221",
            "messageId": "msg_01K7A000000000000000000022",
            "sessionId": "ses_01K7A000000000000000000020",
          },
          "type": "data-taskEvent",
        },
        {
          "input": {
            "path": "map.png",
          },
          "metadata": {
            "createdAt": "2026-10-14T12:03:42.000Z",
            "endedAt": "2026-10-14T12:00:23.000Z",
            "id": "prt_01K7A000000000000000000222",
            "messageId": "msg_01K7A000000000000000000022",
            "sessionId": "ses_01K7A000000000000000000020",
            "startedAt": "2026-10-14T12:00:22.000Z",
          },
          "output": {
            "blob": "sha256-a694d888a1b59b444944827ef314d864d2bb445ac852f1fcd4939c4e835a460f.png",
            "bytes": 16,
            "filePath": "map.png",
            "mediaType": "image/png",
            "mimeType": "image/png",
            "modifiedAt": 1,
            "state": "image",
          },
          "rawInput": {
            "filePath": "map.png",
          },
          "state": "output-available",
          "toolCallId": "call-222",
          "type": "tool-read_file",
        },
      ]
    `);
    const [session] = (await foldFolder(dir)).sessions;
    expect(session?.messages.at(-1)?.parts).toMatchInlineSnapshot(`
      [
        {
          "data": {
            "originalType": "data-adoptedTask",
            "reason": "no schema for data-adoptedTask",
          },
          "metadata": {
            "createdAt": 2026-10-14T12:03:40.000Z,
            "id": "prt_01K7A000000000000000000220",
            "messageId": "msg_01K7A000000000000000000022",
            "sessionId": "ses_01K7A000000000000000000020",
          },
          "type": "data-unknown",
        },
        {
          "data": {
            "originalType": "data-taskEvent",
            "reason": "✖ Invalid input: expected string, received undefined
        → at events[0].sessionId",
          },
          "metadata": {
            "createdAt": 2026-10-14T12:03:41.000Z,
            "id": "prt_01K7A000000000000000000221",
            "messageId": "msg_01K7A000000000000000000022",
            "sessionId": "ses_01K7A000000000000000000020",
          },
          "type": "data-unknown",
        },
        {
          "input": {
            "path": "map.png",
          },
          "metadata": {
            "createdAt": 2026-10-14T12:03:42.000Z,
            "endedAt": 2026-10-14T12:00:23.000Z,
            "id": "prt_01K7A000000000000000000222",
            "messageId": "msg_01K7A000000000000000000022",
            "sessionId": "ses_01K7A000000000000000000020",
            "startedAt": 2026-10-14T12:00:22.000Z,
          },
          "output": {
            "blob": "sha256-a694d888a1b59b444944827ef314d864d2bb445ac852f1fcd4939c4e835a460f.png",
            "bytes": 16,
            "filePath": "map.png",
            "mediaType": "image/png",
            "mimeType": "image/png",
            "modifiedAt": 1,
            "state": "image",
          },
          "state": "output-available",
          "toolCallId": "call-222",
          "type": "tool-read_file",
        },
      ]
    `);
    expect(await listing(dir)).toMatchInlineSnapshot(`
      [
        "blobs/sha256-a694d888a1b59b444944827ef314d864d2bb445ac852f1fcd4939c4e835a460f.png",
        "chat.db",
        "ses_01K7A000000000000000000020.dev_AAAAAAAA.jsonl",
        "settings.dev_AAAAAAAA.jsonl",
      ]
    `);
  });

  it("will not convert a chat whose part lines hold the read of a payload rather than the payload", async () => {
    const dir = chatPath("writes-what-it-read");
    await writeOlderThanSchemasChat(dir);
    const before = await contents(dir);
    writeReadParts();

    const result = await convertChat(dir, OPTIONS);

    expect(result).toMatchInlineSnapshot(`
      {
        "differences": [
          {
            "old": ""t1"",
            "path": "ses_01K7A000000000000000000020/msg_01K7A000000000000000000022/prt_01K7A000000000000000000220 line.data.handle",
          },
          {
            "now": ""data-adoptedTask"",
            "path": "ses_01K7A000000000000000000020/msg_01K7A000000000000000000022/prt_01K7A000000000000000000220 line.data.originalType",
          },
          {
            "now": ""no schema for data-adoptedTask"",
            "path": "ses_01K7A000000000000000000020/msg_01K7A000000000000000000022/prt_01K7A000000000000000000220 line.data.reason",
          },
          {
            "old": ""Find hotels"",
            "path": "ses_01K7A000000000000000000020/msg_01K7A000000000000000000022/prt_01K7A000000000000000000220 line.data.title",
          },
          {
            "now": ""data-unknown"",
            "old": ""data-adoptedTask"",
            "path": "ses_01K7A000000000000000000020/msg_01K7A000000000000000000022/prt_01K7A000000000000000000220 line.type",
          },
          {
            "old": "[{"status":"done","summary":"Three hotels","title":"Find hotels"}]",
            "path": "ses_01K7A000000000000000000020/msg_01K7A000000000000000000022/prt_01K7A000000000000000000221 line.data.events",
          },
          {
            "now": ""data-taskEvent"",
            "path": "ses_01K7A000000000000000000020/msg_01K7A000000000000000000022/prt_01K7A000000000000000000221 line.data.originalType",
          },
          {
            "now": ""✖ Invalid input: expected string, received undefined\\n  → at events[0].sessionId"",
            "path": "ses_01K7A000000000000000000020/msg_01K7A000000000000000000022/prt_01K7A000000000000000000221 line.data.reason",
          },
          {
            "now": ""data-unknown"",
            "old": ""data-taskEvent"",
            "path": "ses_01K7A000000000000000000020/msg_01K7A000000000000000000022/prt_01K7A000000000000000000221 line.type",
          },
          {
            "old": "{"filePath":"map.png"}",
            "path": "ses_01K7A000000000000000000020/msg_01K7A000000000000000000022/prt_01K7A000000000000000000222 line.rawInput",
          },
        ],
        "kind": "different",
      }
    `);
    expect(await contents(dir)).toEqual(before);
  });

  it("finds what the records would not hold, and leaves the chat as it was", async () => {
    const dir = chatPath("holds-a-map");
    await writeHoldsAMapChat(dir);
    const before = await contents(dir);

    const result = await convertChat(dir, OPTIONS);

    expect(result).toMatchInlineSnapshot(`
      {
        "differences": [
          {
            "old": "[["words",3]]",
            "path": "ses_01K7A000000000000000000001/msg_01K7A000000000000000000001/prt_01K7A000000000000000000010.output.<Map>",
          },
        ],
        "kind": "different",
      }
    `);
    expect(await contents(dir)).toEqual(before);
  });

  it("removes what a run cut off while writing left, and converts the chat", async () => {
    const dir = chatPath("cut-off-writing");
    await writeEveryKindChat(dir);
    const work = path.join(dir, ".~convert-4242.tmp");
    await fs.mkdir(path.join(work, "source"), { recursive: true });
    await fs.mkdir(path.join(work, "blobs"));
    await fs.copyFile(
      path.join(dir, "chat.db"),
      path.join(work, "source", "chat.db"),
    );
    await fs.writeFile(
      path.join(work, logFileName(CHAT_SESSION, DEVICE_A)),
      '{"t":"session","seq":0,"at":"2026-',
    );
    await fs.writeFile(path.join(work, "blobs", ".~sha256-0.png.tmp"), "ha");
    expect((await foldFolder(dir)).sessions).toEqual([]);

    const result = await convertChat(dir, OPTIONS);

    expect(result.kind).toBe("converted");
    expect(await listing(dir)).toEqual(EVERY_KIND_FILES);
  });

  it("finishes moving what a run cut off while moving left", async () => {
    const dir = chatPath("cut-off-moving");
    await writeEveryKindChat(dir);
    await convertChat(dir, OPTIONS);
    const converted = await contents(dir);
    // As the rename into place left it: the settings, one log and every blob
    // still in the committed folder.
    const done = path.join(dir, ".~converted-4242.tmp");
    await fs.mkdir(path.join(done, "blobs"), { recursive: true });
    for (const name of EVERY_KIND_FILES.filter(
      (file) =>
        file.startsWith("blobs/") ||
        file === settingsFileName(DEVICE_A) ||
        file === logFileName(TASK_SESSION, DEVICE_A),
    )) {
      await fs.rename(path.join(dir, name), path.join(done, name));
    }

    const result = await convertChat(dir, OPTIONS);

    expect(result.kind).toBe("already-converted");
    const after = await contents(dir);
    expect(Object.keys(after)).toEqual(EVERY_KIND_FILES);
    for (const [name, { bytes }] of Object.entries(converted)) {
      expect(after[name]?.bytes).toEqual(bytes);
    }
  });

  it("leaves the chat as it was when the records cannot be committed, and converts on the next run", async () => {
    const dir = chatPath("fails-to-commit");
    await writeEveryKindChat(dir);
    const before = await contents(dir);
    failRenamesTo(/\.~converted-\d+\.tmp$/);

    const failed = await convertChat(dir, OPTIONS);

    expect(failed).toEqual({ error: "The disk went away", kind: "failed" });
    expect(await contents(dir)).toEqual(before);
    vi.restoreAllMocks();
    expect((await convertChat(dir, OPTIONS)).kind).toBe("converted");
    expect(await listing(dir)).toEqual(EVERY_KIND_FILES);
  });

  it("finishes on the next run a move into place that failed", async () => {
    const dir = chatPath("fails-to-move");
    await writeEveryKindChat(dir);
    failRenamesTo(/\.jsonl$/);

    const failed = await convertChat(dir, OPTIONS);

    expect(failed).toEqual({ error: "The disk went away", kind: "failed" });
    vi.restoreAllMocks();
    expect((await convertChat(dir, OPTIONS)).kind).toBe("already-converted");
    expect(await listing(dir)).toEqual(EVERY_KIND_FILES);
  });

  it("changes nothing when run again after it converted", async () => {
    const dir = chatPath("converted-twice");
    await writeEveryKindChat(dir);
    await convertChat(dir, OPTIONS);
    const converted = await contents(dir);

    const again = await convertChat(dir, OPTIONS);

    expect(again).toEqual({
      kind: "already-converted",
      store: [path.join(dir, "chat.db")],
    });
    expect(await contents(dir)).toEqual(converted);
  });

  it("counts a converted chat used since as converted", async () => {
    const dir = chatPath("converted-then-used");
    const chat = await writeEveryKindChat(dir);
    expect((await convertChat(dir, OPTIONS)).kind).toBe("converted");
    // The chat.db that could not be set aside, under records that went on
    // to take a turn and start a task.
    await alongsideTheStore(dir, chat, async (records) => {
      await records.appendMessage(
        chat,
        SessionMessage.Schema.parse(
          userMessage(CHAT_SESSION, messageId(99), at(200)),
        ),
      );
      await records.startSession(chat, {
        createdAt: at(201),
        handle: "t2",
        id: sessionId(9),
        parent: CHAT_SESSION,
        title: "Later",
      });
    });

    expect((await convertChat(dir, OPTIONS)).kind).toBe("already-converted");
  });

  it("converts a chat whose only other-device file says nothing", async () => {
    const dir = chatPath("converted-elsewhere");
    await writeUntitledChat(dir);
    // An empty settings file is no history, whichever device wrote it, so the
    // chat's conversation is still only in `chat.db` and has to be written
    // out. Which device wrote a record never decides whether the records hold
    // the conversation; it decides only which files may be written again.
    await fs.writeFile(path.join(dir, settingsFileName(DEVICE_B)), "");

    expect((await convertChat(dir, OPTIONS)).kind).toBe("converted");
    expect(await listing(dir)).toContain(settingsFileName(DEVICE_B));
  });

  it("keeps a chat whose records from another device do not hold its history", async () => {
    const dir = chatPath("half-written-elsewhere");
    const chat = await writeEveryKindChat(dir);
    // What two computers on one synced workspace leave: the other one wrote a
    // turn into the records over a history only `chat.db` holds. Nothing can
    // merge those, so the database stays and the chat is said back.
    await alongsideTheStore(
      dir,
      chat,
      async (records) => {
        await records.saveSession(chat, EVERY_KIND_SESSION);
        await records.appendMessage(
          chat,
          SessionMessage.Schema.parse(
            userMessage(CHAT_SESSION, messageId(99), at(200)),
          ),
        );
      },
      DEVICE_B,
    );
    const before = await contents(dir);

    const result = await convertChat(dir, OPTIONS);

    expect(result.kind).toBe("half-written");
    expect(await contents(dir)).toEqual(before);
  });

  it("leaves another device's records where they are when it converts", async () => {
    const dir = chatPath("beside-another-device");
    const chat = await writeEveryKindChat(dir);
    // A header and settings, which say no more than the session row does. Ours
    // are removed and written again from `chat.db`; the other computer's are
    // its own to write, so they stay as they are.
    await alongsideTheStore(
      dir,
      chat,
      (records) => records.saveSession(chat, EVERY_KIND_SESSION),
      DEVICE_B,
    );
    const theirs = path.join(dir, logFileName(CHAT_SESSION, DEVICE_B));
    const before = await fs.readFile(theirs);

    expect((await convertChat(dir, OPTIONS)).kind).toBe("converted");
    expect(await fs.readFile(theirs)).toEqual(before);
  });

  it("converts a chat the writer beside the store left a header and settings in", async () => {
    // Frozen, so the call left in flight is swept to the same moment in both
    // conversions and the two folders compare byte for byte.
    vi.useFakeTimers({ now: at(500), toFake: ["Date"] });
    const clean = chatPath("restated-clean");
    await writeEveryKindChat(clean);
    expect((await convertChat(clean, OPTIONS)).kind).toBe("converted");

    const dir = chatPath("restated");
    const chat = await writeEveryKindChat(dir);
    // Saving the row is all the app has to do to the chat: the records take
    // its header and the settings it carries, and none of its history.
    await alongsideTheStore(dir, chat, (records) =>
      records.saveSession(chat, EVERY_KIND_SESSION),
    );
    expect(await listing(dir)).toEqual([
      "chat.db",
      logFileName(CHAT_SESSION, DEVICE_A),
      settingsFileName(DEVICE_A),
    ]);
    expect(
      await recordKinds(path.join(dir, logFileName(CHAT_SESSION, DEVICE_A))),
    ).toEqual(["session", "rollover"]);

    const result = await convertChat(dir, OPTIONS);

    expect(result.kind).toBe("converted");
    expect(await listing(dir)).toEqual(EVERY_KIND_FILES);
    expect(await recordFiles(dir)).toEqual(await recordFiles(clean));
  });

  it("converts one whose records a run cut off mid-append", async () => {
    vi.useFakeTimers({ now: at(500), toFake: ["Date"] });
    const clean = chatPath("torn-clean");
    await writeEveryKindChat(clean);
    expect((await convertChat(clean, OPTIONS)).kind).toBe("converted");

    const dir = chatPath("torn");
    const chat = await writeEveryKindChat(dir);
    await alongsideTheStore(dir, chat, (records) =>
      records.saveSession(chat, EVERY_KIND_SESSION),
    );
    // What a crash mid-append leaves: a line with no newline after it. Every
    // reader of these files leaves those bytes for the next read.
    const settings = path.join(dir, settingsFileName(DEVICE_A));
    await fs.appendFile(settings, '{"t":"set","seq":9,"at":');

    const result = await convertChat(dir, OPTIONS);

    expect(result.kind).toBe("converted");
    expect(await listing(dir)).toEqual(EVERY_KIND_FILES);
  });

  it("keeps a chat whose records hold turns a build took before it ran", async () => {
    const dir = chatPath("half-written");
    const chat = await writeEveryKindChat(dir);
    await alongsideTheStore(dir, chat, async (records) => {
      await records.saveSession(chat, EVERY_KIND_SESSION);
      await records.appendMessage(
        chat,
        SessionMessage.Schema.parse(
          userMessage(CHAT_SESSION, messageId(99), at(200)),
        ),
      );
    });
    const before = await contents(dir);

    const result = await convertChat(dir, OPTIONS);

    expect(result.kind).toBe("half-written");
    // The records hold the one message the turn added, and `chat.db` the
    // chat's whole history and a task's, which no log of the records names.
    const where =
      result.kind === "half-written"
        ? result.differences.map(({ path: one }) => one)
        : [];
    expect(where).toContain(`${CHAT_SESSION} messages.length`);
    expect(where).toContain(`${TASK_SESSION}`);
    expect(await contents(dir)).toEqual(before);
  });

  it("says a chat the store could not read is unreadable, and writes nothing", async () => {
    const dir = chatPath("unreadable");
    const s = sessionId(1);
    await writeChat(dir, async (chat) => {
      await saveSession(chat, { createdAt: at(0), id: s, title: "Broken" });
      await saveMessage(chat, userMessage(s, messageId(1), at(1)));
      await tell(chat, StorageKey.message(s, messageId(2)), {
        id: "not a message",
      });
    });
    const before = await contents(dir);

    const result = await convertChat(dir, OPTIONS);

    expect(result.kind).toBe("unreadable");
    expect(result.kind === "unreadable" && result.error).toContain(
      StorageKey.message(s, messageId(2)),
    );
    expect(await contents(dir)).toEqual(before);
  });
});

describe("convertWorkspaceChats", () => {
  it("converts every chat once, and says so of each", async () => {
    const chats = path.join(root.path, "chats");
    await writeEveryKindChat(path.join(chats, "a-trip"));
    await writeUntitledChat(path.join(chats, "b-hello"));
    await fs.mkdir(path.join(chats, "c-no-store"));
    await fs.mkdir(path.join(chats, ".hidden"));
    await fs.writeFile(path.join(chats, "notes.txt"), "not a chat");

    const first = await convertWorkspaceChats(chats, OPTIONS);
    const again = await convertWorkspaceChats(chats, OPTIONS);

    const summary = ({ chats: each, complete, counts }: typeof first) => ({
      chats: each.map(({ dir, kind }) => `${path.basename(dir)}: ${kind}`),
      complete,
      counts,
    });
    expect(summary(first)).toMatchInlineSnapshot(`
      {
        "chats": [
          "a-trip: converted",
          "b-hello: converted",
          "c-no-store: no-store",
        ],
        "complete": true,
        "counts": {
          "already-converted": 0,
          "converted": 2,
          "different": 0,
          "failed": 0,
          "half-written": 0,
          "no-store": 1,
          "unreadable": 0,
        },
      }
    `);
    expect(summary(again)).toMatchInlineSnapshot(`
      {
        "chats": [
          "a-trip: already-converted",
          "b-hello: already-converted",
          "c-no-store: no-store",
        ],
        "complete": true,
        "counts": {
          "already-converted": 2,
          "converted": 0,
          "different": 0,
          "failed": 0,
          "half-written": 0,
          "no-store": 1,
          "unreadable": 0,
        },
      }
    `);
    const [hello] = (await foldFolder(path.join(chats, "b-hello"))).sessions;
    expect(hello?.settings.title?.value).toEqual({
      auto: true,
      text: "New chat",
    });
    expect(hello?.updatedAt).toEqual(at(0));
  });

  it("leaves the chat it could not convert on its chat.db and converts the rest", async () => {
    const chats = path.join(root.path, "chats");
    await writeEveryKindChat(path.join(chats, "a-trip"));
    await writeUntitledChat(path.join(chats, "b-hello"));
    const maps = path.join(chats, "c-maps");
    await writeHoldsAMapChat(maps);
    const kept = await contents(maps);

    const first = await convertWorkspaceChats(chats, OPTIONS);

    expect(first.complete).toBe(false);
    expect(first.counts).toEqual({
      "already-converted": 0,
      converted: 2,
      different: 1,
      failed: 0,
      "half-written": 0,
      "no-store": 0,
      unreadable: 0,
    });
    expect(await contents(maps)).toEqual(kept);
    expect(await listing(path.join(chats, "a-trip"))).toEqual(EVERY_KIND_FILES);

    // The chats that converted have their `chat.db` moved out of the folder
    // before the next launch, which is what makes the retry cost a listing.
    for (const name of ["a-trip", "b-hello"]) {
      await fs.rm(path.join(chats, name, "chat.db"));
    }
    const converted = await contents(path.join(chats, "a-trip"));

    const again = await convertWorkspaceChats(chats, OPTIONS);

    expect(again.counts).toEqual({
      "already-converted": 0,
      converted: 0,
      different: 1,
      failed: 0,
      "half-written": 0,
      "no-store": 2,
      unreadable: 0,
    });
    expect(await contents(path.join(chats, "a-trip"))).toEqual(converted);
  });
});

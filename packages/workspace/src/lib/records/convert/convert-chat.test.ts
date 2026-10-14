import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import superjson from "superjson";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withTempDir } from "../../../test/helpers/temp-dir";
import { disposeSessionsStoreStorage } from "../../session-store-storage";
import { StorageKey } from "../../storage-key";
import { Store } from "../../store";
import { blobPath } from "../blobs";
import { logFileName, marksFileName, parseRecordFileName } from "../file-names";
import { foldChat, type FoldedChat, type FoldedSession } from "../fold";
import { partFromRecord } from "../part-blobs";
import { readLog } from "../read-records";
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
import {
  CHAT_SESSION,
  INTERRUPTED,
  part,
  saveMessage,
  saveSession,
  TASK_SESSION,
  tell,
  writeChat,
  writeEveryKindChat,
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
  "marks.dev_AAAAAAAA.jsonl",
  "ses_01K7A000000000000000000001.dev_AAAAAAAA.jsonl",
  "ses_01K7A000000000000000000002.dev_AAAAAAAA.jsonl",
];

/** Every file under `dir`, by its path from there. */
async function listing(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
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
      case "told":
        return `told ${record.what}`;
      default:
        return record.t;
    }
  });
}

describe("convertChat", () => {
  it("converts every kind of record, which reads back as the store reads it", async () => {
    const dir = chatPath("every-kind");
    const chat = await writeEveryKindChat(dir);
    const stored = new Map(
      await Promise.all(
        [CHAT_SESSION, TASK_SESSION].map(
          async (id) =>
            [
              id,
              (
                await Store.getMessagesWithParts({
                  chatId: chat,
                  inherited: false,
                  sessionId: id,
                })
              )._unsafeUnwrap(),
            ] as const,
        ),
      ),
    );
    await disposeSessionsStoreStorage(chat);
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
        "swept": 0,
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
        "told apps",
        "told browser",
        "told folders",
        "told memory",
        "told processes",
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
        "told folders",
      ]
    `);

    const folded = await foldFolder(dir);
    expect(
      folded.sessions.map(({ messages: _messages, ...session }) => session),
    ).toMatchInlineSnapshot(`
      [
        {
          "chat": "every-kind",
          "createdAt": 2026-10-14T12:00:00.000Z,
          "forked": false,
          "id": "ses_01K7A000000000000000000001",
          "marks": {
            "archived": {
              "at": 2026-10-14T12:00:30.000Z,
              "device": "dev_AAAAAAAA",
              "field": "archived",
              "seq": 2,
              "session": "ses_01K7A000000000000000000001",
              "t": "mark",
              "value": true,
            },
            "starred": {
              "at": 2026-10-14T12:00:20.000Z,
              "device": "dev_AAAAAAAA",
              "field": "starred",
              "seq": 1,
              "session": "ses_01K7A000000000000000000001",
              "t": "mark",
              "value": true,
            },
            "stoppedAt": {
              "at": 2026-10-14T12:00:50.000Z,
              "device": "dev_AAAAAAAA",
              "field": "stoppedAt",
              "seq": 5,
              "session": "ses_01K7A000000000000000000001",
              "t": "mark",
              "value": 2026-10-14T12:00:50.000Z,
            },
            "title": {
              "at": 2026-10-14T12:00:10.000Z,
              "device": "dev_AAAAAAAA",
              "field": "title",
              "seq": 0,
              "session": "ses_01K7A000000000000000000001",
              "t": "mark",
              "value": {
                "settled": true,
                "text": "Plans for the trip",
              },
            },
            "topics": {
              "at": 2026-10-14T12:01:40.000Z,
              "device": "dev_AAAAAAAA",
              "field": "topics",
              "seq": 4,
              "session": "ses_01K7A000000000000000000001",
              "t": "mark",
              "value": [
                "travel",
                "family",
              ],
            },
            "unread": {
              "at": 2026-10-14T12:00:40.000Z,
              "device": "dev_AAAAAAAA",
              "field": "unread",
              "seq": 3,
              "session": "ses_01K7A000000000000000000001",
              "t": "mark",
              "value": {
                "byUser": true,
              },
            },
          },
          "rollover": {
            "after": "msg_01K7A000000000000000000005",
            "usableTokens": 120000,
          },
          "told": {
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
          "chat": "every-kind",
          "createdAt": 2026-10-14T12:01:00.000Z,
          "forked": false,
          "forkedAt": "msg_01K7A000000000000000000003",
          "handle": "t1",
          "id": "ses_01K7A000000000000000000002",
          "marks": {},
          "parent": "ses_01K7A000000000000000000001",
          "stopped": {
            "at": 2026-10-14T12:01:30.000Z,
            "by": "user",
          },
          "title": "Find hotels",
          "told": {
            "folders": [
              {
                "path": "/Users/someone/Trips",
              },
            ],
          },
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

  it("finds what the records would not hold, and leaves the chat as it was", async () => {
    const dir = chatPath("holds-a-map");
    const s = sessionId(1);
    await writeChat(dir, async (chat) => {
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
    // As the rename into place left it: the marks, one log and every blob
    // still in the committed folder.
    const done = path.join(dir, ".~converted-4242.tmp");
    await fs.mkdir(path.join(done, "blobs"), { recursive: true });
    for (const name of EVERY_KIND_FILES.filter(
      (file) =>
        file.startsWith("blobs/") ||
        file === marksFileName(DEVICE_A) ||
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

  it("leaves a chat holding another device's records as it is", async () => {
    const dir = chatPath("converted-elsewhere");
    await writeUntitledChat(dir);
    await fs.writeFile(path.join(dir, marksFileName(DEVICE_B)), "");
    const before = await contents(dir);

    expect((await convertChat(dir, OPTIONS)).kind).toBe("already-converted");
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
          "no-store": 1,
          "unreadable": 0,
        },
      }
    `);
    const [hello] = (await foldFolder(path.join(chats, "b-hello"))).sessions;
    expect(hello?.marks.title?.value).toEqual({
      settled: false,
      text: "New chat",
    });
    expect(hello?.updatedAt).toEqual(at(0));
  });
});

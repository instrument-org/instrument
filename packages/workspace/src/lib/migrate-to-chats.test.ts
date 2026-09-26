import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { chatIdOf } from "../schemas/chat-id";
import { StoreId } from "../schemas/store-id";
import { migrateToChats } from "./migrate-to-chats";

const THREAD = StoreId.SessionSchema.parse("ses_01M3AX9RF3C2E9RTATMB602W0B");
const CHANNEL = StoreId.SessionSchema.parse("ses_01M20Y3V4H2FGY0E5FYMWWFSX6");
const TAB = StoreId.SessionSchema.parse("ses_01M3B00000000000000000TAB0");

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-to-chats-"));
});

afterEach(() => {
  fs.rmSync(root, { force: true, recursive: true });
});

function keysIn(dbFile: string): string[] {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    return db
      .prepare("select key from sessions order by key")
      .all()
      .map((row) => String(row.key));
  } finally {
    db.close();
  }
}

/** The one-conversation layout: a window record whose database holds every chat. */
function oneConversation() {
  const windowDir = path.join(root, "tasks", "instrument", ".instrument");
  writeJson(path.join(windowDir, "settings.json"), {
    createdAt: "2026-09-08T16:37:42.156Z",
    createdWithAppVersion: "2.0.0-beta.0",
    kind: "orchestrator",
    name: "Instrument",
    state: {
      appThreads: { linear: THREAD },
      attachedFolders: {
        Home: {
          access: "read-write",
          createdAt: 1,
          id: "01M20Y3V5QYG9BEP4RPPX77CZV",
          mountName: "Home",
          path: "/Users/someone",
          source: "user",
        },
      },
      channels: [{ id: CHANNEL, name: "Instrument" }],
      selectedModelURI: "zai-org/glm-5.3-flash?provider=instrument",
      taskChannels: { "2026-09-10-from-a-channel": CHANNEL },
      taskThreads: { "2026-09-24-from-a-thread": THREAD },
      threadSeen: { [THREAD]: "msg_01M3AX9RF3C2E9RTATMB602W0C" },
      topics: [
        {
          color: "#e0562f",
          createdAt: 5,
          emoji: "🛒",
          id: "top_01",
          name: "Shopping",
        },
      ],
    },
  });
  const db = new DatabaseSync(path.join(windowDir, "task.db"));
  db.exec(
    "CREATE TABLE sessions (key TEXT PRIMARY KEY, value TEXT, blob BLOB, created_at TEXT, updated_at TEXT)",
  );
  const insert = db.prepare(
    "insert into sessions (key, value, blob) values (?, ?, ?)",
  );
  insert.run("__migration_version__", "3", null);
  for (const [id, title] of [
    [THREAD, "Transcribe the note"],
    [CHANNEL, "Instrument"],
  ] as const) {
    insert.run(
      `sessions:${id}`,
      null,
      superjson({ createdAt: "2026-09-24T23:51:33.605Z", id, title }),
    );
    insert.run(
      `messages:${id}:msg_1`,
      null,
      superjson({ id: "msg_1", role: "user" }),
    );
    insert.run(`parts:${id}:msg_1:prt_1`, null, superjson({ type: "text" }));
  }
  insert.run(
    `parts:${THREAD}:msg_1:prt_2`,
    null,
    superjson({ files: ["attachments/shot.png"], type: "data-attachments" }),
  );
  // A tab of the window's browser: the window's, not a chat's.
  insert.run(
    `browser-state:${TAB}`,
    null,
    superjson({ lastUrl: "https://a.b" }),
  );
  db.close();

  fs.mkdirSync(path.join(root, "tasks", "instrument", "attachments"));
  fs.writeFileSync(
    path.join(root, "tasks", "instrument", "attachments", "shot.png"),
    "png",
  );

  for (const task of [
    "2026-09-24-from-a-thread",
    "2026-09-10-from-a-channel",
  ]) {
    writeJson(path.join(root, "tasks", task, ".instrument", "settings.json"), {
      name: task,
      parentTaskId: "instrument",
    });
  }
  writeJson(
    path.join(
      root,
      "tasks",
      "2026-08-07-a-1x-task",
      ".instrument",
      "settings.json",
    ),
    { name: "A 1.x task" },
  );
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

function superjson(json: Record<string, unknown>) {
  return Buffer.from(JSON.stringify({ json }));
}

function tree(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(root, path.join(entry.parentPath, entry.name)),
    )
    .filter((file) => !file.startsWith(".pre-chats"))
    .sort();
}

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

describe("migrateToChats", () => {
  it("gives each chat a folder of its own, with the tasks it started inside it", () => {
    oneConversation();

    expect(migrateToChats(root)).toEqual({
      chatCount: 2,
      movedTaskCount: 2,
      topicCount: 1,
    });

    const thread = chatIdOf(THREAD);
    const channel = chatIdOf(CHANNEL);
    expect(tree(root)).toMatchInlineSnapshot(`
      [
        "chats/chat-01m20y3v4h2fgy0e5fymwwfsx6/.instrument/settings.json",
        "chats/chat-01m20y3v4h2fgy0e5fymwwfsx6/.instrument/task.db",
        "chats/chat-01m20y3v4h2fgy0e5fymwwfsx6/tasks/2026-09-10-from-a-channel/.instrument/settings.json",
        "chats/chat-01m3ax9rf3c2e9rtatmb602w0b/.instrument/settings.json",
        "chats/chat-01m3ax9rf3c2e9rtatmb602w0b/.instrument/task.db",
        "chats/chat-01m3ax9rf3c2e9rtatmb602w0b/attachments/shot.png",
        "chats/chat-01m3ax9rf3c2e9rtatmb602w0b/tasks/2026-09-24-from-a-thread/.instrument/settings.json",
        "tasks/2026-08-07-a-1x-task/.instrument/settings.json",
        "tasks/instrument/.instrument/settings.json",
        "tasks/instrument/.instrument/task.db",
        "topics/top_01/topic.md",
      ]
    `);
    expect(keysIn(path.join(root, "chats", thread, ".instrument", "task.db")))
      .toMatchInlineSnapshot(`
        [
          "__migration_version__",
          "messages:ses_01M3AX9RF3C2E9RTATMB602W0B:msg_1",
          "parts:ses_01M3AX9RF3C2E9RTATMB602W0B:msg_1:prt_1",
          "parts:ses_01M3AX9RF3C2E9RTATMB602W0B:msg_1:prt_2",
          "sessions:ses_01M3AX9RF3C2E9RTATMB602W0B",
        ]
      `);
    expect(
      keysIn(path.join(root, "tasks", "instrument", ".instrument", "task.db")),
    ).toEqual(["__migration_version__", `browser-state:${TAB}`]);

    expect(
      readJson(
        path.join(root, "chats", thread, ".instrument", "settings.json"),
      ),
    ).toMatchInlineSnapshot(`
        {
          "createdAt": "2026-09-24T23:51:33.605Z",
          "createdWithAppVersion": "2.0.0-beta.0",
          "kind": "orchestrator",
          "lastActivityAt": "2026-09-24T23:51:33.605Z",
          "name": "Transcribe the note",
          "state": {
            "attachedFolders": {
              "Home": {
                "access": "read-write",
                "createdAt": 1,
                "id": "01M20Y3V5QYG9BEP4RPPX77CZV",
                "mountName": "Home",
                "path": "/Users/someone",
                "source": "user",
              },
            },
            "selectedModelURI": "zai-org/glm-5.3-flash?provider=instrument",
          },
        }
      `);
    expect(
      readJson(
        path.join(
          root,
          "chats",
          channel,
          "tasks",
          "2026-09-10-from-a-channel",
          ".instrument",
          "settings.json",
        ),
      ).parentTaskId,
    ).toBe(channel);
    expect(
      Object.keys(
        readJson(
          path.join(
            root,
            "tasks",
            "instrument",
            ".instrument",
            "settings.json",
          ),
        ).state as object,
      ).sort(),
    ).toEqual([
      "appThreads",
      "attachedFolders",
      "selectedModelURI",
      "threadSeen",
    ]);
  });

  it("runs once, and a second run changes nothing", () => {
    oneConversation();
    migrateToChats(root);
    const before = tree(root);

    expect(migrateToChats(root)).toEqual({
      chatCount: 0,
      movedTaskCount: 0,
      topicCount: 0,
    });
    expect(tree(root)).toEqual(before);
  });

  it("moves what an older build wrote in the old layout after an earlier run", () => {
    oneConversation();
    migrateToChats(root);
    // An older beta run in between writes a new thread into the window again.
    const db = new DatabaseSync(
      path.join(root, "tasks", "instrument", ".instrument", "task.db"),
    );
    const later = StoreId.SessionSchema.parse("ses_01M3C0000000000000000000N1");
    db.prepare("insert into sessions (key, value, blob) values (?, ?, ?)").run(
      `sessions:${later}`,
      null,
      superjson({ createdAt: "2026-09-27T10:00:00.000Z", id: later }),
    );
    db.close();

    expect(migrateToChats(root).chatCount).toBe(1);
    expect(fs.existsSync(path.join(root, "chats", chatIdOf(later)))).toBe(true);
  });

  it("leaves a workspace with no conversation alone", () => {
    writeJson(
      path.join(
        root,
        "tasks",
        "2026-08-07-a-1x-task",
        ".instrument",
        "settings.json",
      ),
      { name: "A 1.x task" },
    );

    expect(migrateToChats(root)).toEqual({
      chatCount: 0,
      movedTaskCount: 0,
      topicCount: 0,
    });
    expect(fs.existsSync(path.join(root, "chats"))).toBe(false);
  });
});

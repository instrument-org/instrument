import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
    superjson({ files: ["attachments/data.png"], type: "data-attachments" }),
  );
  insert.run(
    `parts:${CHANNEL}:msg_1:prt_3`,
    null,
    superjson({ files: ["attachments/a.png"], type: "data-attachments" }),
  );
  insert.run(
    `parts:${THREAD}:msg_1:prt_4`,
    null,
    superjson({ text: "Saved /task/work/shot.png and work/shared.md", type: "text" }),
  );
  insert.run(
    `parts:${CHANNEL}:msg_1:prt_5`,
    null,
    superjson({ text: "See work/shared.md", type: "text" }),
  );
  // A session the store would not take back: its rows stay where they are.
  insert.run("sessions:ses_legacy1", null, superjson({ id: "ses_legacy1" }));
  insert.run("messages:ses_legacy1:msg_9", null, superjson({ role: "user" }));
  // A tab of the window's browser: the window's, not a chat's.
  insert.run(
    `browser-state:${TAB}`,
    null,
    superjson({ lastUrl: "https://a.b" }),
  );
  db.close();

  // Two sent files, one's name inside the other's, and a command's output
  // spilled to a file named for the part it was written for.
  const windowFolder = path.join(root, "tasks", "instrument");
  fs.mkdirSync(path.join(windowFolder, "attachments"));
  fs.writeFileSync(path.join(windowFolder, "attachments", "data.png"), "png");
  fs.writeFileSync(path.join(windowFolder, "attachments", "a.png"), "png");
  fs.mkdirSync(path.join(windowFolder, ".tool-output"));
  fs.writeFileSync(path.join(windowFolder, ".tool-output", "prt_2.log"), "out");
  // A screenshot the thread's agent took, and a file both chats name.
  fs.mkdirSync(path.join(windowFolder, "work"));
  fs.writeFileSync(path.join(windowFolder, "work", "shot.png"), "png");
  fs.writeFileSync(path.join(windowFolder, "work", "shared.md"), "md");

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

const THREAD_CHAT = "2026-09-24-transcribe-the-note";
const CHANNEL_CHAT = "2026-09-24-instrument";

describe("migrateToChats", () => {
  it("gives each chat a readable folder of its own, with the tasks it started inside it", () => {
    oneConversation();

    expect(migrateToChats(root)).toEqual({
      chatCount: 2,
      leftOver: 0,
      movedTaskCount: 2,
      topicCount: 1,
    });

    expect(tree(root)).toMatchInlineSnapshot(`
      [
        "chats/2026-09-24-instrument/.instrument/settings.json",
        "chats/2026-09-24-instrument/.instrument/task.db",
        "chats/2026-09-24-instrument/attachments/a.png",
        "chats/2026-09-24-instrument/tasks/2026-09-10-from-a-channel/.instrument/settings.json",
        "chats/2026-09-24-transcribe-the-note/.instrument/settings.json",
        "chats/2026-09-24-transcribe-the-note/.instrument/task.db",
        "chats/2026-09-24-transcribe-the-note/.tool-output/prt_2.log",
        "chats/2026-09-24-transcribe-the-note/attachments/data.png",
        "chats/2026-09-24-transcribe-the-note/tasks/2026-09-24-from-a-thread/.instrument/settings.json",
        "chats/2026-09-24-transcribe-the-note/work/shot.png",
        "tasks/2026-08-07-a-1x-task/.instrument/settings.json",
        "tasks/instrument/.instrument/settings.json",
        "tasks/instrument/.instrument/task.db",
        "tasks/instrument/work/shared.md",
        "topics/top_01/topic.md",
      ]
    `);
    expect(
      keysIn(path.join(root, "chats", THREAD_CHAT, ".instrument", "task.db")),
    ).toMatchInlineSnapshot(`
      [
        "__migration_version__",
        "messages:ses_01M3AX9RF3C2E9RTATMB602W0B:msg_1",
        "parts:ses_01M3AX9RF3C2E9RTATMB602W0B:msg_1:prt_1",
        "parts:ses_01M3AX9RF3C2E9RTATMB602W0B:msg_1:prt_2",
        "parts:ses_01M3AX9RF3C2E9RTATMB602W0B:msg_1:prt_4",
        "sessions:ses_01M3AX9RF3C2E9RTATMB602W0B",
      ]
    `);
    // The window keeps its tabs' rows, the store's version, and the session
    // that could not become a chat.
    expect(
      keysIn(path.join(root, "tasks", "instrument", ".instrument", "task.db")),
    ).toEqual([
      "__migration_version__",
      `browser-state:${TAB}`,
      "messages:ses_legacy1:msg_9",
      "sessions:ses_legacy1",
    ]);
    expect(
      readJson(
        path.join(root, "chats", THREAD_CHAT, ".instrument", "settings.json"),
      ),
    ).toMatchInlineSnapshot(`
      {
        "chatSessionId": "ses_01M3AX9RF3C2E9RTATMB602W0B",
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
          CHANNEL_CHAT,
          "tasks",
          "2026-09-10-from-a-channel",
          ".instrument",
          "settings.json",
        ),
      ).parentTaskId,
    ).toBe(CHANNEL_CHAT);
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
      leftOver: 0,
      movedTaskCount: 0,
      topicCount: 0,
    });
    expect(tree(root)).toEqual(before);
  });

  it("finishes a task an interrupted run moved before it could rename its parent", () => {
    oneConversation();
    migrateToChats(root);
    const settingsFile = path.join(
      root,
      "chats",
      THREAD_CHAT,
      "tasks",
      "2026-09-24-from-a-thread",
      ".instrument",
      "settings.json",
    );
    // As a crash between the move and the settings leaves it, with the map
    // that sends the run back to it.
    writeJson(settingsFile, {
      name: "2026-09-24-from-a-thread",
      parentTaskId: "instrument",
    });
    const windowSettings = path.join(
      root,
      "tasks",
      "instrument",
      ".instrument",
      "settings.json",
    );
    const window = readJson(windowSettings);
    writeJson(windowSettings, {
      ...window,
      state: {
        ...(window.state as object),
        taskThreads: { "2026-09-24-from-a-thread": THREAD },
      },
    });

    migrateToChats(root);

    expect(readJson(settingsFile).parentTaskId).toBe(THREAD_CHAT);
  });

  it("keeps the maps while a task could not move, and moves it on a later run", () => {
    oneConversation();
    // Something already stands where the task would go.
    fs.mkdirSync(
      path.join(
        root,
        "chats",
        THREAD_CHAT,
        "tasks",
        "2026-09-24-from-a-thread",
      ),
      { recursive: true },
    );
    writeJson(
      path.join(root, "chats", THREAD_CHAT, ".instrument", "settings.json"),
      {
        chatSessionId: THREAD,
        kind: "orchestrator",
        name: "Transcribe the note",
      },
    );

    expect(migrateToChats(root).leftOver).toBe(1);
    const state = readJson(
      path.join(root, "tasks", "instrument", ".instrument", "settings.json"),
    ).state as Record<string, unknown>;
    expect(state.taskThreads).toBeDefined();
    expect(
      fs.existsSync(path.join(root, "tasks", "2026-09-24-from-a-thread")),
    ).toBe(true);

    fs.rmSync(
      path.join(
        root,
        "chats",
        THREAD_CHAT,
        "tasks",
        "2026-09-24-from-a-thread",
      ),
      { recursive: true },
    );
    expect(migrateToChats(root).movedTaskCount).toBe(1);
  });

  it("keeps a chat's rows, tasks and maps in the window while its database cannot be written", () => {
    oneConversation();
    // An earlier run named the chat, and something stands where its database goes.
    writeJson(
      path.join(root, "chats", THREAD_CHAT, ".instrument", "settings.json"),
      { chatSessionId: THREAD, kind: "orchestrator", name: "Instrument" },
    );
    fs.mkdirSync(path.join(root, "chats", THREAD_CHAT, ".instrument", "task.db"));

    const migration = migrateToChats(root);
    expect(migration.chatCount).toBe(1);
    expect(migration.leftOver).toBe(2);
    const windowDb = path.join(root, "tasks", "instrument", ".instrument", "task.db");
    expect(keysIn(windowDb).filter((key) => key.includes(THREAD))).toHaveLength(5);
    expect(fs.existsSync(path.join(root, "tasks", "2026-09-24-from-a-thread"))).toBe(true);
    const state = readJson(
      path.join(root, "tasks", "instrument", ".instrument", "settings.json"),
    ).state as Record<string, unknown>;
    expect(state.taskThreads).toBeDefined();

    fs.rmSync(path.join(root, "chats", THREAD_CHAT, ".instrument", "task.db"), {
      recursive: true,
    });
    expect(migrateToChats(root)).toMatchObject({ leftOver: 0, movedTaskCount: 1 });
    expect(keysIn(windowDb).filter((key) => key.includes(THREAD))).toEqual([]);
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
      superjson({
        createdAt: "2026-09-27T10:00:00.000Z",
        id: later,
        title: "Later",
      }),
    );
    db.close();

    expect(migrateToChats(root).chatCount).toBe(1);
    expect(fs.existsSync(path.join(root, "chats", "2026-09-27-later"))).toBe(
      true,
    );
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
      leftOver: 0,
      movedTaskCount: 0,
      topicCount: 0,
    });
    expect(fs.existsSync(path.join(root, "chats"))).toBe(false);
  });
});

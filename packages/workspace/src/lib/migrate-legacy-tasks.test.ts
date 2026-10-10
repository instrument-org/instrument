import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import superjson from "superjson";
import { ulid } from "ulid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrateLegacyTasks } from "./migrate-legacy-tasks";
import { readTopicsSync, writeTopicSync } from "./chat/topics";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-legacy-tasks-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { force: true, recursive: true });
});

interface FixtureMessage {
  metadata?: Record<string, unknown>;
  parts: FixturePart[];
  role: "assistant" | "session-context" | "user";
}

interface FixturePart {
  data?: unknown;
  input?: unknown;
  state?: string;
  text?: string;
  type: string;
}

const JUNE_23 = Date.parse("2026-06-23T21:47:33.119Z");

/** The conversation a chat holds, one line per part, as the chat's agent will read it. */
function conversationIn(chat: string): string[] {
  const db = new DatabaseSync(
    path.join(root, "chats", chat, ".instrument", "task.db"),
    {
      readOnly: true,
    },
  );
  try {
    const rows = db
      .prepare("select key, blob from sessions order by key")
      .all()
      .map((row) => ({
        key: String(row.key),
        value: superjson.parse<Record<string, unknown>>(String(row.blob)),
      }));
    const messages = rows
      .filter((row) => row.key.startsWith("messages:"))
      .map((row) => row.value);
    return messages.flatMap((message) =>
      rows
        .filter(
          (row) =>
            row.key.startsWith(`parts:`) &&
            row.key.includes(`:${String(message.id)}:`),
        )
        .map(({ value: part }) => {
          const detail =
            part.type === "text"
              ? String(part.text)
              : JSON.stringify(part.data);
          return `${String(message.role)} ${String(part.type)}: ${detail}`;
        }),
    );
  } finally {
    db.close();
  }
}

/** A task as 1.x left it: its settings, and a database of sessions in the store's shape. */
function legacyTask(
  name: string,
  {
    sessions = [],
    settings = {},
  }: {
    sessions?: { at?: number; messages: FixtureMessage[]; title?: string }[];
    settings?: Record<string, unknown>;
  },
) {
  const chatDir = path.join(root, "tasks", name);
  writeJson(path.join(chatDir, ".instrument", "settings.json"), {
    createdAt: new Date(JUNE_23).toISOString(),
    createdWithAppVersion: "1.2.0",
    lastActivityAt: new Date(JUNE_23 + 60_000).toISOString(),
    name: "Rotating red square video",
    ...settings,
  });
  const db = new DatabaseSync(path.join(chatDir, ".instrument", "task.db"));
  db.exec(
    "CREATE TABLE sessions (key TEXT PRIMARY KEY, value TEXT, blob BLOB, created_at TEXT, updated_at TEXT)",
  );
  const insert = db.prepare("insert into sessions (key, blob) values (?, ?)");
  let at = JUNE_23;
  for (const session of sessions) {
    at = session.at ?? at;
    const sessionId = `ses_${ulid(at)}`;
    insert.run(
      `sessions:${sessionId}`,
      stored({ createdAt: new Date(at), id: sessionId, title: session.title }),
    );
    for (const message of session.messages) {
      at += 1000;
      const messageId = `msg_${ulid(at)}`;
      insert.run(
        `messages:${sessionId}:${messageId}`,
        stored({
          id: messageId,
          metadata: { createdAt: new Date(at), sessionId, ...message.metadata },
          role: message.role,
        }),
      );
      for (const part of message.parts) {
        at += 1;
        const partId = `prt_${ulid(at)}`;
        insert.run(
          `parts:${sessionId}:${messageId}:${partId}`,
          stored({
            ...part,
            metadata: {
              createdAt: new Date(at),
              id: partId,
              messageId,
              sessionId,
            },
          }),
        );
      }
    }
    at += 60_000;
  }
  db.close();
  return chatDir;
}

function readJson(...segments: string[]): Record<string, unknown> {
  // A settings file this suite wrote itself.
  return JSON.parse(
    fs.readFileSync(path.join(root, ...segments), "utf8"),
  ) as Record<string, unknown>;
}

function sessionOf(chat: string): Record<string, unknown> {
  const db = new DatabaseSync(
    path.join(root, "chats", chat, ".instrument", "task.db"),
    {
      readOnly: true,
    },
  );
  try {
    const row = db
      .prepare("select blob from sessions where key like 'sessions:%'")
      .get();
    return superjson.parse(String(row?.blob));
  } finally {
    db.close();
  }
}

function stored(value: unknown): Buffer {
  return Buffer.from(superjson.stringify(value));
}

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

function writeProject(
  name: string,
  {
    folders = [],
    id,
    instructions = "",
  }: { folders?: unknown[]; id: string; instructions?: string },
) {
  const dir = path.join(root, "projects", name);
  writeJson(path.join(dir, ".instrument", "settings.json"), {
    createdAt: "2026-06-26T11:23:50.372Z",
    folders,
    id,
  });
  fs.writeFileSync(path.join(dir, "AGENTS.md"), instructions);
}

const ONE_ASK: { messages: FixtureMessage[] }[] = [
  {
    messages: [
      {
        parts: [
          { text: "You are a general-purpose AI assistant", type: "text" },
        ],
        role: "session-context",
      },
      {
        parts: [
          {
            text: "Use FFmpeg to make me a short video of a rotating red square.",
            type: "text",
          },
        ],
        role: "user",
      },
      {
        metadata: { modelId: "auto", providerId: "instrument" },
        parts: [
          { type: "step-start" },
          { text: "thinking", type: "reasoning" },
          {
            input: { command: "ffmpeg" },
            state: "output-available",
            type: "tool-bash",
          },
        ],
        role: "assistant",
      },
      {
        metadata: { modelId: "auto", providerId: "instrument" },
        parts: [
          {
            text: "Done! [Open it](output/square.mp4), or see [the docs](https://example.com).\n\n```files\noutput/square.mp4\n```",
            type: "text",
          },
          {
            data: {
              files: [
                { filePath: "output/square.mp4", status: "added" },
                { filePath: "output/draft.mp4", status: "added" },
                { filePath: "output/draft.mp4", status: "deleted" },
                { filePath: "work/skills/ffmpeg/SKILL.md", status: "added" },
                { filePath: "output/gone.mp4", status: "added" },
              ],
            },
            type: "data-fileChanges",
          },
        ],
        role: "assistant",
      },
    ],
  },
];

describe("migrateLegacyTasks", () => {
  it("makes a 1.x task into a chat, in its own folder, holding what the user saw", () => {
    const chatDir = legacyTask("2026-06-23-use-ffmpeg", { sessions: ONE_ASK });
    fs.mkdirSync(path.join(chatDir, "output"));
    fs.writeFileSync(path.join(chatDir, "output", "square.mp4"), "video");

    expect(migrateLegacyTasks(root)).toEqual({
      adoptedCount: 1,
      emptyCount: 0,
      leftOver: 0,
      topicCount: 0,
    });

    const chat = "2026-06-23-rotating-red-square";
    expect(fs.readdirSync(path.join(root, "chats"))).toEqual([chat]);
    expect(fs.readdirSync(path.join(root, "tasks"))).toEqual([]);
    // The task's folder is the chat's: its files where its replies named them,
    // and no task inside it.
    expect(
      fs.readFileSync(
        path.join(root, "chats", chat, "output", "square.mp4"),
        "utf8",
      ),
    ).toBe("video");
    expect(fs.existsSync(path.join(root, "chats", chat, "tasks"))).toBe(false);
    expect(
      fs.readdirSync(path.join(root, "chats", chat, ".instrument")).toSorted(),
    ).toEqual(["settings.json", "task.db"]);
    // The task's own record, set aside.
    expect(
      fs
        .readdirSync(path.join(root, ".pre-chats", "task-records", chat))
        .toSorted(),
    ).toEqual(["settings.json", "task.db"]);

    const settings = readJson("chats", chat, ".instrument", "settings.json");
    expect(settings).toMatchObject({
      createdAt: "2026-06-23T21:47:33.119Z",
      createdWithAppVersion: "1.2.0",
      lastActivityAt: "2026-06-23T21:48:33.119Z",
      name: "Rotating red square video",
    });
    // The task held no folders, so neither does the chat.
    expect(
      (settings.state as { attachedFolders: Record<string, unknown> })
        .attachedFolders,
    ).toEqual({});
    const session = sessionOf(chat);
    expect(settings.chatSessionId).toBe(session.id);
    expect(session).toMatchObject({
      title: "Rotating red square video",
      titleSettledAt: new Date(JUNE_23),
    });

    // Text, not bytes, which the store refuses to read.
    const db = new DatabaseSync(
      path.join(root, "chats", chat, ".instrument", "task.db"),
      { readOnly: true },
    );
    expect(
      db.prepare("select distinct typeof(blob) as type from sessions").all(),
    ).toEqual([{ type: "text" }]);
    db.close();

    expect(conversationIn(chat)).toMatchInlineSnapshot(`
      [
        "user text: Use FFmpeg to make me a short video of a rotating red square.",
        "assistant text: Done! [Open it](output/square.mp4), or see [the docs](https://example.com).

      \`\`\`files
      output/square.mp4
      \`\`\`",
      ]
    `);
  });

  it("leaves each chat read, but for one whose task 1.x had marked unread", () => {
    legacyTask("2026-06-23-read", { sessions: ONE_ASK });
    legacyTask("2026-06-24-unread", {
      sessions: ONE_ASK,
      settings: { name: "Unread one", unreadIndicator: { kind: "completed" } },
    });
    legacyTask("2026-06-25-by-hand", {
      sessions: ONE_ASK,
      settings: {
        name: "By hand",
        unreadIndicator: { kind: "completed", manual: true },
      },
    });

    migrateLegacyTasks(root);

    const read = sessionOf("2026-06-23-rotating-red-square");
    expect(read.unreadAt).toBeUndefined();
    const unread = sessionOf("2026-06-23-unread-one");
    expect(unread.unreadAt).toBeInstanceOf(Date);
    expect(unread.unreadByUser).toBeUndefined();
    // A mark the user put on the task stays theirs.
    expect(sessionOf("2026-06-23-by-hand").unreadByUser).toBe(true);
  });

  it("gives the chat the task's folders, so a reply's /mnt paths reach the same files", () => {
    legacyTask("2026-06-23-make-me-a-bike", {
      sessions: [
        {
          messages: [
            { parts: [{ text: "make me a bike", type: "text" }], role: "user" },
            {
              metadata: { modelId: "m", providerId: "p" },
              parts: [
                {
                  text: "Saved.\n\n```files\n/mnt/My bikes/bike.png\n/mnt/Me/notes.md\n```",
                  type: "text",
                },
              ],
              role: "assistant",
            },
          ],
        },
      ],
      settings: {
        name: "Bike",
        state: {
          attachedFolders: {
            // Lent by a project, which is gone once the task is a chat's.
            "My bikes": {
              access: "read-write",
              createdAt: 2,
              id: "01M0TK69A9HZTK4A32J3VC7R9R",
              mountName: "My bikes",
              path: "/Users/someone/Documents/bikes",
              source: "project",
            },
            Me: {
              access: "read-write",
              createdAt: 3,
              id: "01M0TK69A9HZTK4A32J3VC7R9S",
              mountName: "Me",
              path: "/Users/someone",
              source: "user",
            },
          },
        },
      },
    });

    migrateLegacyTasks(root);

    const chat = "2026-06-23-bike";
    const folders = (
      readJson("chats", chat, ".instrument", "settings.json").state as {
        attachedFolders: Record<string, { path: string; source: string }>;
      }
    ).attachedFolders;
    expect(
      Object.fromEntries(
        Object.entries(folders).map(([mount, folder]) => [
          folder.path,
          `${mount} (${folder.source})`,
        ]),
      ),
    ).toEqual({
      "/Users/someone": "Me (user)",
      "/Users/someone/Documents/bikes": "My bikes (user)",
    });
    expect(conversationIn(chat).at(-1)).toBe(
      "assistant text: Saved.\n\n```files\n/mnt/My bikes/bike.png\n/mnt/Me/notes.md\n```",
    );
  });

  it("stars a pinned task's chat", () => {
    legacyTask("2026-06-23-pinned", {
      sessions: ONE_ASK,
      settings: { pinnedAt: "2026-07-01T00:00:00.000Z" },
    });

    migrateLegacyTasks(root);

    expect(sessionOf("2026-06-23-rotating-red-square").starredAt).toEqual(
      new Date("2026-07-01T00:00:00.000Z"),
    );
  });

  it("copies the words of every session in order, into the chat's one", () => {
    legacyTask("2026-06-23-two-sessions", {
      sessions: [
        {
          messages: [
            { parts: [{ text: "first ask", type: "text" }], role: "user" },
          ],
        },
        {
          messages: [
            { parts: [{ text: "second ask", type: "text" }], role: "user" },
            {
              metadata: { modelId: "m", providerId: "p" },
              parts: [{ text: "second answer", type: "text" }],
              role: "assistant",
            },
          ],
        },
      ],
    });

    migrateLegacyTasks(root);

    expect(conversationIn("2026-06-23-rotating-red-square")).toEqual([
      "user text: first ask",
      "user text: second ask",
      "assistant text: second answer",
    ]);
  });

  it("keeps the files the user sent where its messages name them", () => {
    const chatDir = legacyTask("2026-06-23-photo", {
      sessions: [
        {
          messages: [
            {
              parts: [
                { text: "what is this?", type: "text" },
                {
                  data: {
                    files: [
                      {
                        filename: "cat.png",
                        filePath: "attachments/cat.png",
                        mimeType: "image/png",
                        size: 3,
                      },
                    ],
                  },
                  type: "data-attachments",
                },
              ],
              role: "user",
            },
          ],
        },
      ],
    });
    fs.mkdirSync(path.join(chatDir, "attachments"));
    fs.writeFileSync(path.join(chatDir, "attachments", "cat.png"), "cat");

    migrateLegacyTasks(root);

    const chat = "2026-06-23-rotating-red-square";
    expect(
      fs.readFileSync(
        path.join(root, "chats", chat, "attachments", "cat.png"),
        "utf8",
      ),
    ).toBe("cat");
    expect(conversationIn(chat)[1]).toBe(
      'user data-attachments: {"files":[{"filename":"cat.png","filePath":"attachments/cat.png","mimeType":"image/png","modifiedAt":0,"size":3}]}',
    );
  });

  it("makes projects into topics, joining one of the same name, and files their tasks' chats under them", () => {
    writeTopicSync(root, {
      createdAt: Date.parse("2026-09-17T17:07:55.921Z"),
      emoji: "🛒",
      folders: [{ path: "/Users/someone/Lists" }],
      id: "top_01M2R5DNCH9PJ09F2CV1VEMM77",
      instructions: "Prefer Target.",
      name: "Shopping",
    });
    writeProject("Shopping", {
      // 1.x stored a folder as its path, or as its path and access.
      folders: [
        "/Users/someone/Lists",
        { access: "read-only", path: "/Users/someone/Receipts" },
      ],
      id: "prj_01KXB5K5ZSQNZ8NQJPQRYRAAS1",
      instructions: "Ship to home.",
    });
    writeProject("🐛 Bug tasks", {
      id: "prj_01M00Q67JH4P7FHH53ZBHH2XWZ",
      instructions: "File in Linear.",
    });
    legacyTask("2026-06-23-shopping", {
      sessions: ONE_ASK,
      settings: {
        name: "Buy socks",
        projectId: "prj_01KXB5K5ZSQNZ8NQJPQRYRAAS1",
      },
    });
    legacyTask("2026-06-23-bug", {
      sessions: ONE_ASK,
      settings: { name: "A bug", projectId: "prj_01M00Q67JH4P7FHH53ZBHH2XWZ" },
    });

    expect(migrateLegacyTasks(root).topicCount).toBe(1);

    const topics = readTopicsSync(root);
    expect(
      topics.map(({ emoji, folders, instructions, name }) => ({
        emoji,
        folders,
        instructions,
        name,
      })),
    ).toEqual([
      {
        emoji: "🐛",
        folders: undefined,
        instructions: "File in Linear.",
        name: "Bug tasks",
      },
      {
        emoji: "🛒",
        folders: [
          { path: "/Users/someone/Lists" },
          { path: "/Users/someone/Receipts" },
        ],
        instructions: "Prefer Target.\n\nShip to home.",
        name: "Shopping",
      },
    ]);
    const made = topics.find((topic) => topic.name === "Bug tasks")?.id;
    expect(sessionOf("2026-06-23-buy-socks").topics).toEqual([
      "top_01M2R5DNCH9PJ09F2CV1VEMM77",
    ]);
    expect(sessionOf("2026-06-23-a-bug").topics).toEqual([made]);
    expect(
      readJson("chats", "2026-06-23-a-bug", ".instrument", "settings.json")
        .projectId,
    ).toBeUndefined();
    expect(fs.existsSync(path.join(root, "projects"))).toBe(false);
    expect(
      fs.readdirSync(path.join(root, ".pre-chats", "projects")).toSorted(),
    ).toEqual(["Shopping", "🐛 Bug tasks"]);
  });

  it("keeps two projects whose names meet at a topic's length apart, on every boot", () => {
    writeProject("Marketing campaign spring 2025", {
      folders: ["/Users/someone/2025"],
      id: "prj_01KXB5K5ZSQNZ8NQJPQRYRAAS1",
    });
    writeProject("Marketing campaign spring 2026", {
      folders: ["/Users/someone/2026"],
      id: "prj_01M00Q67JH4P7FHH53ZBHH2XWZ",
    });
    legacyTask("2026-06-23-spring", {
      sessions: ONE_ASK,
      settings: { name: "Plan", projectId: "prj_01M00Q67JH4P7FHH53ZBHH2XWZ" },
    });

    expect(migrateLegacyTasks(root).topicCount).toBe(2);
    legacyTask("2026-06-24-later", { sessions: ONE_ASK });
    migrateLegacyTasks(root);

    expect(
      readTopicsSync(root).map(({ folders, name, projectId }) => ({
        folders,
        name,
        projectId,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "folders": [
            {
              "path": "/Users/someone/2025",
            },
          ],
          "name": "Marketing campaign sprin",
          "projectId": "prj_01KXB5K5ZSQNZ8NQJPQRYRAAS1",
        },
        {
          "folders": [
            {
              "path": "/Users/someone/2026",
            },
          ],
          "name": "Marketing campaign spr 2",
          "projectId": "prj_01M00Q67JH4P7FHH53ZBHH2XWZ",
        },
      ]
    `);
  });

  it("keeps a file the user left beside the projects, and the folder holding it", () => {
    writeProject("Shopping", { id: "prj_01KXB5K5ZSQNZ8NQJPQRYRAAS1" });
    fs.writeFileSync(path.join(root, "projects", "notes.txt"), "mine");

    migrateLegacyTasks(root);

    expect(
      fs.readFileSync(path.join(root, "projects", "notes.txt"), "utf8"),
    ).toBe("mine");
  });

  it("sets aside a task the user never said anything in, and the tutorial", () => {
    legacyTask("2026-06-23-empty", { sessions: [] });
    legacyTask("2026-06-23-tutorial", {
      sessions: [
        {
          messages: [
            { parts: [{ text: "Show me around", type: "text" }], role: "user" },
            {
              metadata: {
                modelId: "tutorial-task-replay",
                providerId: "tutorial-task-replay",
              },
              parts: [{ text: "Welcome", type: "text" }],
              role: "assistant",
            },
          ],
        },
      ],
    });

    expect(migrateLegacyTasks(root)).toMatchObject({
      adoptedCount: 0,
      emptyCount: 2,
    });
    expect(fs.existsSync(path.join(root, "chats"))).toBe(false);
    expect(
      fs.readdirSync(path.join(root, ".pre-chats", "empty-tasks")).toSorted(),
    ).toEqual(["2026-06-23-empty", "2026-06-23-tutorial"]);
  });

  it("leaves chats, the tasks they own, and the window alone, so a second boot changes nothing", () => {
    legacyTask("2026-06-23-use-ffmpeg", { sessions: ONE_ASK });
    migrateLegacyTasks(root);
    const before = fs.readdirSync(root, { recursive: true }).toSorted();

    expect(migrateLegacyTasks(root)).toEqual({
      adoptedCount: 0,
      emptyCount: 0,
      leftOver: 0,
      topicCount: 0,
    });
    expect(fs.readdirSync(root, { recursive: true }).toSorted()).toEqual(
      before,
    );
  });

  it("leaves a task whose settings cannot be read where it is, for Storage to list", () => {
    legacyTask("2026-06-23-use-ffmpeg", { sessions: ONE_ASK });
    const corrupt = path.join(root, "tasks", "2026-06-24-corrupt");
    fs.mkdirSync(path.join(corrupt, ".instrument"), { recursive: true });
    fs.writeFileSync(
      path.join(corrupt, ".instrument", "settings.json"),
      '{"name": "Half',
    );

    expect(migrateLegacyTasks(root)).toMatchObject({
      adoptedCount: 1,
      leftOver: 0,
    });
    expect(fs.readdirSync(path.join(corrupt, ".instrument"))).toEqual([
      "settings.json",
    ]);
  });

  it("leaves a task whose move fails where it was, lists no chat for it, and adopts it next boot", () => {
    const chatDir = legacyTask("2026-06-23-use-ffmpeg", { sessions: ONE_ASK });
    const rename = fs.renameSync.bind(fs);
    const spy = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(from) === chatDir) {
        throw Object.assign(new Error("EBUSY"), { code: "EBUSY" });
      }
      rename(from, to);
    });

    expect(migrateLegacyTasks(root)).toMatchObject({
      adoptedCount: 0,
      leftOver: 1,
    });
    expect(fs.readdirSync(path.join(root, "chats"))).toEqual([]);
    expect(
      fs.readdirSync(path.join(chatDir, ".instrument")).toSorted(),
    ).toEqual(["settings.json", "task.db"]);

    spy.mockRestore();
    expect(migrateLegacyTasks(root)).toMatchObject({
      adoptedCount: 1,
      leftOver: 0,
    });
  });

  it.each([
    ["before it was named", (from: string) => from.endsWith(".partial")],
    [
      "between its database and its settings",
      (from: string) => from.endsWith(".chat-settings.json"),
    ],
  ])("finishes a chat a boot cut short %s", (_, cutsShort) => {
    legacyTask("2026-06-23-use-ffmpeg", { sessions: ONE_ASK });
    const rename = fs.renameSync.bind(fs);
    const spy = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (cutsShort(String(from))) {
        throw Object.assign(new Error("EIO"), { code: "EIO" });
      }
      rename(from, to);
    });
    expect(migrateLegacyTasks(root).leftOver).toBe(1);
    spy.mockRestore();

    migrateLegacyTasks(root);

    const chat = "2026-06-23-rotating-red-square";
    expect(fs.readdirSync(path.join(root, "chats"))).toEqual([chat]);
    const settings = readJson("chats", chat, ".instrument", "settings.json");
    expect(settings.chatSessionId).toBe(sessionOf(chat).id);
    expect(
      fs.readdirSync(path.join(root, "chats", chat, ".instrument")).toSorted(),
    ).toEqual(["settings.json", "task.db"]);
    expect(
      readJson(".pre-chats", "task-records", chat, "settings.json").name,
    ).toBe("Rotating red square video");
  });
});

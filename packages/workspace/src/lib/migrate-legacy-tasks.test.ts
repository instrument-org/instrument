import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import superjson from "superjson";
import { ulid } from "ulid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrateLegacyTasks } from "./migrate-legacy-tasks";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-legacy-tasks-"));
  writeJson(
    path.join(root, "tasks", "instrument", ".instrument", "settings.json"),
    {
      kind: "orchestrator",
      name: "Instrument",
      state: {
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
        chatSeen: {
          ses_01M3AX9RF3C2E9RTATMB602W0B: "msg_01M3AX9RF3C2E9RTATMB602W0C",
        },
      },
    },
  );
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
    sessions?: { messages: FixtureMessage[]; title?: string }[];
    settings?: Record<string, unknown>;
  },
) {
  const taskDir = path.join(root, "tasks", name);
  writeJson(path.join(taskDir, ".instrument", "settings.json"), {
    createdAt: new Date(JUNE_23).toISOString(),
    createdWithAppVersion: "1.2.0",
    lastActivityAt: new Date(JUNE_23 + 60_000).toISOString(),
    name: "Rotating red square video",
    ...settings,
  });
  const db = new DatabaseSync(path.join(taskDir, ".instrument", "task.db"));
  db.exec(
    "CREATE TABLE sessions (key TEXT PRIMARY KEY, value TEXT, blob BLOB, created_at TEXT, updated_at TEXT)",
  );
  const insert = db.prepare("insert into sessions (key, blob) values (?, ?)");
  let at = JUNE_23;
  for (const session of sessions) {
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
  return taskDir;
}

/** A chat's message ids, oldest first. */
function messageIds(chat: string): string[] {
  const db = new DatabaseSync(
    path.join(root, "chats", chat, ".instrument", "task.db"),
    {
      readOnly: true,
    },
  );
  try {
    return db
      .prepare(
        "select key from sessions where key like 'messages:%' order by key",
      )
      .all()
      .map((row) => String(row.key).split(":")[2] ?? "");
  } finally {
    db.close();
  }
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
  { id, instructions = "" }: { id: string; instructions?: string },
) {
  const dir = path.join(root, "projects", name);
  writeJson(path.join(dir, ".instrument", "settings.json"), {
    createdAt: "2026-06-26T11:23:50.372Z",
    folders: [],
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
            text: "Done! I've made it.\n\n```files\noutput/square.mp4\n```",
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
  it("makes a 1.x task into a chat that owns it, holding what the user saw", () => {
    const taskDir = legacyTask("2026-06-23-use-ffmpeg", { sessions: ONE_ASK });
    fs.mkdirSync(path.join(taskDir, "output"));
    fs.writeFileSync(path.join(taskDir, "output", "square.mp4"), "video");

    expect(migrateLegacyTasks(root)).toEqual({
      adoptedCount: 1,
      emptyCount: 0,
      leftOver: 0,
      topicCount: 0,
    });

    const chat = "2026-06-23-rotating-red-square";
    expect(fs.readdirSync(path.join(root, "chats"))).toEqual([chat]);
    expect(fs.readdirSync(path.join(root, "tasks"))).toEqual(["instrument"]);
    expect(
      readJson(
        "chats",
        chat,
        "tasks",
        "2026-06-23-use-ffmpeg",
        ".instrument",
        "settings.json",
      ).parentTaskId,
    ).toBe(chat);

    const settings = readJson("chats", chat, ".instrument", "settings.json");
    expect(settings).toMatchObject({
      createdAt: "2026-06-23T21:47:33.119Z",
      createdWithAppVersion: "1.2.0",
      kind: "orchestrator",
      lastActivityAt: "2026-06-23T21:48:33.119Z",
      name: "Rotating red square video",
    });
    // Every folder granted anywhere, as a chat made today starts with.
    expect(
      Object.values(
        (
          settings.state as {
            attachedFolders: Record<string, { path: string }>;
          }
        ).attachedFolders,
      ).map((folder) => folder.path),
    ).toEqual(["/Users/someone"]);
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
        "user data-adoptedTask: {"files":["/tasks/2026-06-23-use-ffmpeg/output/square.mp4"],"taskId":"2026-06-23-use-ffmpeg"}",
        "assistant text: Done! I've made it.

      \`\`\`files
      /tasks/2026-06-23-use-ffmpeg/output/square.mp4
      \`\`\`",
      ]
    `);
  });

  it("marks each chat read, but for one reply where 1.x had marked the task unread", () => {
    legacyTask("2026-06-23-read", { sessions: ONE_ASK });
    legacyTask("2026-06-24-unread", {
      sessions: ONE_ASK,
      settings: { name: "Unread one", unreadIndicator: { kind: "completed" } },
    });

    migrateLegacyTasks(root);

    const seen = readJson("tasks", "instrument", ".instrument", "settings.json")
      .state as {
      chatSeen: Record<string, string>;
    };
    const read = sessionOf("2026-06-23-rotating-red-square").id as string;
    const unread = sessionOf("2026-06-23-unread-one").id as string;
    // The chat already there keeps its mark.
    expect(Object.keys(seen.chatSeen)).toHaveLength(3);
    expect(seen.chatSeen[read]).toBe(
      messageIds("2026-06-23-rotating-red-square").at(-1),
    );
    // One short of the newest reply, so that reply alone counts.
    expect(seen.chatSeen[unread]).toBe(
      messageIds("2026-06-23-unread-one").at(-2),
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

    expect(
      conversationIn("2026-06-23-rotating-red-square").filter(
        (line) => !line.includes("data-adoptedTask"),
      ),
    ).toEqual([
      "user text: first ask",
      "user text: second ask",
      "assistant text: second answer",
    ]);
  });

  it("clones the files the user sent into the chat", () => {
    const taskDir = legacyTask("2026-06-23-photo", {
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
    fs.mkdirSync(path.join(taskDir, "attachments"));
    fs.writeFileSync(path.join(taskDir, "attachments", "cat.png"), "cat");

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
    const existing = path.join(
      root,
      "topics",
      "top_01M2R5DNCH9PJ09F2CV1VEMM77",
      "topic.md",
    );
    fs.mkdirSync(path.dirname(existing), { recursive: true });
    fs.writeFileSync(
      existing,
      '---\nname: "Shopping"\nemoji: "🛒"\ncreated: 2026-09-17T17:07:55.921Z\n---\nPrefer Target.\n',
    );
    writeProject("Shopping", {
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

    expect(fs.readFileSync(existing, "utf8")).toMatchInlineSnapshot(`
      "---
      name: "Shopping"
      emoji: "🛒"
      created: 2026-09-17T17:07:55.921Z
      ---
      Prefer Target.

      Ship to home.
      "
    `);
    const made = fs
      .readdirSync(path.join(root, "topics"))
      .find((id) => !existing.includes(id));
    expect(
      fs.readFileSync(
        path.join(root, "topics", made ?? "", "topic.md"),
        "utf8",
      ),
    ).toMatchInlineSnapshot(`
      "---
      name: "Bug tasks"
      emoji: "🐛"
      created: 2026-06-26T11:23:50.372Z
      ---
      File in Linear.
      "
    `);
    expect(sessionOf("2026-06-23-buy-socks").topics).toEqual([
      "top_01M2R5DNCH9PJ09F2CV1VEMM77",
    ]);
    expect(sessionOf("2026-06-23-a-bug").topics).toEqual([made]);
    expect(
      readJson(
        "chats",
        "2026-06-23-a-bug",
        "tasks",
        "2026-06-23-bug",
        ".instrument",
        "settings.json",
      ).projectId,
    ).toBeUndefined();
    expect(fs.existsSync(path.join(root, "projects"))).toBe(false);
    expect(
      fs.readdirSync(path.join(root, ".pre-chats", "projects")).toSorted(),
    ).toEqual(["Shopping", "🐛 Bug tasks"]);
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

  it("leaves a task whose move fails where it was, lists no chat for it, and adopts it next boot", () => {
    const taskDir = legacyTask("2026-06-23-use-ffmpeg", { sessions: ONE_ASK });
    const rename = fs.renameSync.bind(fs);
    const spy = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(from) === taskDir) {
        throw Object.assign(new Error("EBUSY"), { code: "EBUSY" });
      }
      rename(from, to);
    });

    expect(migrateLegacyTasks(root)).toMatchObject({
      adoptedCount: 0,
      leftOver: 1,
    });
    expect(fs.readdirSync(path.join(root, "chats"))).toEqual([]);
    expect(fs.existsSync(taskDir)).toBe(true);

    spy.mockRestore();
    expect(migrateLegacyTasks(root)).toMatchObject({
      adoptedCount: 1,
      leftOver: 0,
    });
  });

  it("finishes a chat a boot staged with its task inside, and discards one staged without", () => {
    const staged = path.join(root, "chats", ".2026-06-23-staged.partial");
    writeJson(path.join(staged, ".instrument", "settings.json"), {
      kind: "orchestrator",
    });
    writeJson(
      path.join(
        staged,
        "tasks",
        "2026-06-23-inside",
        ".instrument",
        "settings.json",
      ),
      {
        name: "Inside",
      },
    );
    const empty = path.join(root, "chats", ".2026-06-23-empty.partial");
    writeJson(path.join(empty, ".instrument", "settings.json"), {
      kind: "orchestrator",
    });

    migrateLegacyTasks(root);

    expect(fs.readdirSync(path.join(root, "chats"))).toEqual([
      "2026-06-23-staged",
    ]);
    expect(
      readJson(
        "chats",
        "2026-06-23-staged",
        "tasks",
        "2026-06-23-inside",
        ".instrument",
        "settings.json",
      ),
    ).toEqual({ name: "Inside", parentTaskId: "2026-06-23-staged" });
  });
});

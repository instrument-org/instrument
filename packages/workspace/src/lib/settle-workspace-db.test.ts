import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { withTempDir } from "../test/helpers/temp-dir";
import { settleWorkspaceDb } from "./settle-workspace-db";
import { writeStoreRowsSync } from "./store-table";

const temp = withTempDir("settle-workspace-db");

function dirs() {
  const machineDir = path.join(temp.path, "machine");
  const rootDir = path.join(temp.path, "workspace");
  return {
    activityFile: path.join(rootDir, ".instrument", "ai-usage.db"),
    databaseFile: path.join(machineDir, "workspace.db"),
    machineDir,
    rootDir,
    setAsideDir: path.join(rootDir, ".instrument", ".pre-chats", "window"),
    windowDir: path.join(rootDir, ".instrument", "window"),
  };
}

/** The activity file an earlier build kept in the workspace, in WAL mode as it ran, with a request per id. */
function writeFormerActivity(file: string, ids: string[]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const former = new DatabaseSync(file);
  former.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE requests (
      id TEXT PRIMARY KEY,
      started_at INTEGER NOT NULL,
      duration_ms INTEGER,
      status TEXT NOT NULL,
      error TEXT,
      finish_reason TEXT,
      kind TEXT NOT NULL,
      purpose TEXT NOT NULL,
      session_id TEXT,
      chat_id TEXT,
      surface TEXT,
      connection_id TEXT,
      connection_type TEXT,
      connection_name TEXT,
      model_requested TEXT,
      model_served TEXT,
      response_id TEXT,
      input_tokens INTEGER,
      cache_read_tokens INTEGER,
      cache_write_tokens INTEGER,
      output_tokens INTEGER,
      reasoning_tokens INTEGER,
      total_tokens INTEGER
    ) STRICT;
    PRAGMA user_version = 1;
  `);
  const insert = former.prepare(
    "INSERT INTO requests (id, started_at, duration_ms, status, kind, purpose, chat_id, model_served, input_tokens, output_tokens, total_tokens) VALUES (?, ?, 1200, 'finished', 'language', 'chat', 'chat-a', 'served-model', 100, 20, 120)",
  );
  ids.forEach((id, index) => insert.run(id, 1_760_000_000_000 + index));
  return former;
}

function activityRows(file: string) {
  const database = new DatabaseSync(file);
  try {
    return database
      .prepare(
        "SELECT id, started_at, duration_ms, status, kind, purpose, chat_id, model_served, total_tokens FROM activity ORDER BY id",
      )
      .all();
  } finally {
    database.close();
  }
}

function write(file: string, contents: string | Uint8Array = "") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

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

describe("settleWorkspaceDb", () => {
  it("makes workspace.db and removes the index folder, once", () => {
    const { databaseFile, machineDir, rootDir } = dirs();
    fs.mkdirSync(path.join(machineDir, "index"), { recursive: true });
    const index = new DatabaseSync(path.join(machineDir, "index", "chats.db"));
    index.exec(
      "CREATE TABLE chat_digests (id TEXT PRIMARY KEY, stamp TEXT NOT NULL, value TEXT NOT NULL) STRICT; INSERT INTO chat_digests VALUES ('ses_1', '1:1', '{}')",
    );
    index.close();

    const first = settleWorkspaceDb({ machineDir, rootDir });

    expect(first).toEqual({
      done: [
        `removed ${path.join(machineDir, "index")}, which workspace.db replaces`,
      ],
      failed: 0,
    });
    expect(fs.existsSync(path.join(machineDir, "index"))).toBe(false);
    expect(fs.existsSync(databaseFile)).toBe(true);

    expect(settleWorkspaceDb({ machineDir, rootDir })).toEqual({
      done: [],
      failed: 0,
    });
  });

  it("moves the activity log's rows in, rows its log had not checkpointed included, and removes its file", () => {
    const { activityFile, databaseFile, machineDir, rootDir } = dirs();
    // Copied while open, so its rows are still in its write-ahead log, as
    // they are when an earlier build quit without checkpointing.
    const scratch = path.join(temp.path, "scratch", "ai-usage.db");
    const former = writeFormerActivity(scratch, ["req_1", "req_2", "req_3"]);
    fs.mkdirSync(path.dirname(activityFile), { recursive: true });
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.copyFileSync(`${scratch}${suffix}`, `${activityFile}${suffix}`);
    }
    former.close();
    expect(fs.statSync(`${activityFile}-wal`).size).toBeGreaterThan(0);

    const settled = settleWorkspaceDb({ machineDir, rootDir });

    expect(settled).toEqual({
      done: [`moved 3 activity rows in from ${activityFile} and removed it`],
      failed: 0,
    });
    expect(fs.readdirSync(path.dirname(activityFile))).toEqual([]);
    expect(activityRows(databaseFile)).toEqual(
      ["req_1", "req_2", "req_3"].map((id, index) => ({
        chat_id: "chat-a",
        duration_ms: 1200,
        id,
        kind: "language",
        model_served: "served-model",
        purpose: "chat",
        started_at: 1_760_000_000_000 + index,
        status: "finished",
        total_tokens: 120,
      })),
    );

    expect(settleWorkspaceDb({ machineDir, rootDir })).toEqual({
      done: [],
      failed: 0,
    });
    expect(activityRows(databaseFile)).toHaveLength(3);
  });

  it("finishes a move a launch cut short, keeping the rows already in", () => {
    const { activityFile, databaseFile, machineDir, rootDir } = dirs();
    writeFormerActivity(activityFile, ["req_1", "req_2"]).close();
    settleWorkspaceDb({ machineDir, rootDir });
    // The file back as it was, as though the launch stopped before removing it.
    writeFormerActivity(activityFile, ["req_1", "req_2", "req_3"]).close();
    const database = new DatabaseSync(databaseFile);
    database.exec("UPDATE activity SET status = 'stopped' WHERE id = 'req_1'");
    database.close();

    expect(settleWorkspaceDb({ machineDir, rootDir })).toEqual({
      done: [`moved 3 activity rows in from ${activityFile} and removed it`],
      failed: 0,
    });
    expect(
      activityRows(databaseFile).map((row) => [row.id, row.status]),
    ).toEqual([
      ["req_1", "stopped"],
      ["req_2", "finished"],
      ["req_3", "finished"],
    ]);
    expect(fs.existsSync(activityFile)).toBe(false);
  });

  it("leaves an activity file SQLite cannot read for the next launch", () => {
    const { activityFile, machineDir, rootDir } = dirs();
    write(activityFile, "not a database either");

    const settled = settleWorkspaceDb({ machineDir, rootDir });

    expect(settled.failed).toBe(1);
    expect(settled.done).toEqual([
      expect.stringMatching(
        /^could not move the activity log in from .*ai-usage\.db \(Error: file is not a database\)$/,
      ),
    ]);
    expect(fs.readFileSync(activityFile, "utf8")).toBe("not a database either");
  });

  it("moves a workspace.db SQLite cannot read aside and makes it again", () => {
    const { databaseFile, machineDir, rootDir } = dirs();
    write(databaseFile, "not a database, not even close to one");

    const settled = settleWorkspaceDb({ machineDir, rootDir });

    expect(settled.failed).toBe(0);
    const aside = tree(machineDir).filter((name) =>
      name.includes(".unreadable-"),
    );
    expect(aside).toEqual([
      expect.stringMatching(/^workspace\.db\.unreadable-\d+$/),
    ]);
    expect(settled.done).toEqual([
      `moved aside ${databaseFile}, which SQLite could not read, to ${path.join(machineDir, aside[0] ?? "")}`,
    ]);
    expect(fs.readFileSync(path.join(machineDir, aside[0] ?? ""), "utf8")).toBe(
      "not a database, not even close to one",
    );
    const database = new DatabaseSync(databaseFile);
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM meta").get(),
    ).toEqual({ count: 0 });
    database.close();
  });

  describe("the window's former record folder", () => {
    it("removes a store that holds only its migration marker, and the folder", () => {
      const { machineDir, rootDir, windowDir } = dirs();
      fs.mkdirSync(windowDir, { recursive: true });
      const store = path.join(windowDir, "chat.db");
      writeStoreRowsSync(store, [["__migration_version__", 9]]);

      expect(settleWorkspaceDb({ machineDir, rootDir })).toEqual({
        done: [
          `removed ${store}, which held no records`,
          `removed ${windowDir}, the window's former record folder`,
        ],
        failed: 0,
      });
      expect(fs.existsSync(windowDir)).toBe(false);
      expect(settleWorkspaceDb({ machineDir, rootDir })).toEqual({
        done: [],
        failed: 0,
      });
    });

    it("sets aside a store that holds records, and anything else in the folder", () => {
      const { machineDir, rootDir, setAsideDir, windowDir } = dirs();
      fs.mkdirSync(windowDir, { recursive: true });
      writeStoreRowsSync(path.join(windowDir, "chat.db"), [
        ["__migration_version__", 9],
        [
          "browser-state:ses_01K7A000000000000000000001",
          { lastUsedAt: new Date(0), visitedHosts: ["example.com"] },
        ],
      ]);
      write(path.join(windowDir, "settings.json"), "{}");
      write(path.join(windowDir, "attachments", "note.txt"), "kept");

      const settled = settleWorkspaceDb({ machineDir, rootDir });

      expect(settled.failed).toBe(0);
      expect(fs.existsSync(windowDir)).toBe(false);
      expect(tree(setAsideDir)).toEqual([
        path.join("attachments", "note.txt"),
        "chat.db",
        "settings.json",
      ]);
      const aside = new DatabaseSync(path.join(setAsideDir, "chat.db"));
      expect(
        aside.prepare("SELECT key FROM sessions ORDER BY key").all(),
      ).toEqual([
        { key: "__migration_version__" },
        { key: "browser-state:ses_01K7A000000000000000000001" },
      ]);
      aside.close();
    });

    it("leaves an entry whose place aside is taken, and the folder with it, for the next launch", () => {
      const { machineDir, rootDir, setAsideDir, windowDir } = dirs();
      write(path.join(windowDir, "settings.json"), "the window's");
      write(path.join(setAsideDir, "settings.json"), "set aside before");

      const settled = settleWorkspaceDb({ machineDir, rootDir });

      expect(settled).toEqual({
        done: [
          `left ${path.join(windowDir, "settings.json")}: ${path.join(setAsideDir, "settings.json")} is already there`,
        ],
        failed: 1,
      });
      expect(
        fs.readFileSync(path.join(windowDir, "settings.json"), "utf8"),
      ).toBe("the window's");
    });
  });
});

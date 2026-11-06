import fs from "node:fs";
import path from "node:path";
import { type DatabaseSync, type SQLInputValue } from "node:sqlite";
import { ulid } from "ulid";

import { getWorkspaceConfig } from "../workspace-config";
import { versionMatches, workspaceTables } from "../workspace-db";
import { type LinesRead, readLinesFrom } from "../workspace-files";
import {
  activityFileOf,
  activityFiles,
  lineOf,
  monthEndOf,
  rowOf,
} from "./log-file";
import {
  ACTIVITY_FACETS,
  type ActivityEntry,
  type ActivityFacet,
  type ActivityFilter,
  type ActivityRow,
  ActivityRowSchema,
  type ActivitySort,
} from "./schema";

/**
 * The activity log's index: every device's requests, as the files in the
 * workspace hold them (`log-file.ts`), in the `activity` table of
 * `workspace.db` on this computer, for the Settings panel to filter, sort
 * and count. The files are the record and the table is rebuilt from them;
 * `activity_files` keeps how far each file has been read, so a look reads
 * only what a file gained. A request this device makes goes to its own file
 * and into the table at once.
 */
const ACTIVITY_VERSION = 3;

const COLUMNS = {
  cacheReadTokens: "cache_read_tokens",
  cacheWriteTokens: "cache_write_tokens",
  chatId: "chat_id",
  connectionName: "connection_name",
  connectionType: "connection_type",
  device: "device",
  durationMs: "duration_ms",
  error: "error",
  finishReason: "finish_reason",
  id: "id",
  imageQuality: "image_quality",
  inputTokens: "input_tokens",
  kind: "kind",
  modelRequested: "model_requested",
  modelServed: "model_served",
  outputTokens: "output_tokens",
  purpose: "purpose",
  reasoningTokens: "reasoning_tokens",
  responseId: "response_id",
  sessionId: "session_id",
  startedAt: "started_at",
  status: "status",
  surface: "surface",
  totalTokens: "total_tokens",
} as const satisfies Record<keyof ActivityRow, string>;

const KEYS = Object.keys(COLUMNS) as (keyof ActivityRow)[]; // Object.keys widens to string[]

const INSERT_ROW = `INSERT OR IGNORE INTO activity (${KEYS.map((key) => COLUMNS[key]).join(", ")}) VALUES (${KEYS.map(() => "?").join(", ")})`;

const SELECT_ROW = Object.entries(COLUMNS)
  .map(([key, column]) => `${column} AS "${key}"`)
  .join(", ");

// The model a person filters and sorts by: the one that answered when the
// response said, otherwise the one asked for.
const MODEL = "COALESCE(model_served, model_requested)";
// A row's origin, as the filter writes it.
const ORIGIN =
  "CASE WHEN chat_id IS NOT NULL THEN 'chat:' || chat_id WHEN surface IS NOT NULL THEN 'surface:' || surface END";

const FACET_EXPRESSIONS: Record<ActivityFacet, string> = {
  // A connection by the name Providers shows it under, or its kind when it has none.
  connection: "COALESCE(connection_name, connection_type)",
  kind: "kind",
  model: MODEL,
  origin: ORIGIN,
  purpose: "purpose",
  status: "status",
};

const SORT_EXPRESSIONS: Record<ActivitySort["column"], string> = {
  durationMs: "duration_ms",
  kind: "kind",
  model: MODEL,
  purpose: "purpose",
  startedAt: "started_at",
  totalTokens: "total_tokens",
};

let reported = false;

/**
 * Makes the activity tables in a workspace's database where they are
 * missing, at first use.
 */
function makeActivityTable(database: DatabaseSync): void {
  database.exec("BEGIN");
  try {
    // The table is an index of the files, so one made by an earlier build
    // is dropped and read again from them.
    if (!versionMatches(database, "activity", ACTIVITY_VERSION)) {
      database.exec(
        "DROP TABLE IF EXISTS activity; DROP TABLE IF EXISTS activity_files;",
      );
    }
    database.exec(`
      CREATE TABLE IF NOT EXISTS activity (
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
        total_tokens INTEGER,
        device TEXT,
        image_quality TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS activity_files (
        path TEXT PRIMARY KEY,
        size INTEGER NOT NULL,
        mtime_ms REAL NOT NULL,
        read_to INTEGER NOT NULL
      ) STRICT;
    `);
    database.exec(`
      CREATE INDEX IF NOT EXISTS activity_started ON activity (started_at, id);
      CREATE INDEX IF NOT EXISTS activity_kind ON activity (kind, started_at);
      CREATE INDEX IF NOT EXISTS activity_purpose ON activity (purpose, started_at);
      CREATE INDEX IF NOT EXISTS activity_connection ON activity (connection_type, started_at);
      CREATE INDEX IF NOT EXISTS activity_chat ON activity (chat_id, started_at);
    `);
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) {
      database.exec("ROLLBACK");
    }
    throw error;
  }
}

/**
 * The served workspace's database with its activity tables, or undefined
 * where there is nowhere to keep one (tests and scripts with no
 * `workspaceDbFile`) or it could not be opened, which leaves recording off.
 */
const openStore = workspaceTables((database) => {
  makeActivityTable(database);
  return database;
});

/**
 * Brings the table up to every device's files: reads what each file gained
 * since it was last read, whole lines only, and adds the rows it has not
 * seen. A file that shrank, which one writer appending never does but a
 * sync engine replacing it might, is read again from its start. A file a
 * cloud service keeps by name only is waited for while it downloads, since
 * nothing else ever downloads another device's activity file; the read is
 * off the main thread. One that cannot be read now is tried on the next look.
 * Cheap when nothing changed: a stat per file.
 */
async function catchUpActivity(database: DatabaseSync): Promise<void> {
  const { rootDir } = getWorkspaceConfig();
  const known = new Map(
    database
      .prepare("SELECT path, size, mtime_ms, read_to FROM activity_files")
      .all()
      .map((row) => [
        String(row.path),
        {
          mtimeMs: Number(row.mtime_ms),
          readTo: Number(row.read_to),
          size: Number(row.size),
        },
      ]),
  );
  const insert = database.prepare(INSERT_ROW);
  const remember = database.prepare(
    "INSERT INTO activity_files (path, size, mtime_ms, read_to) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms, read_to = excluded.read_to",
  );
  for (const { device, file } of activityFiles(rootDir)) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    const seen = known.get(file);
    if (seen && seen.size === stat.size && seen.mtimeMs === stat.mtimeMs) {
      continue;
    }
    const from = seen && stat.size >= seen.readTo ? seen.readTo : 0;
    let read: LinesRead;
    try {
      read = await readLinesFrom(file, from);
    } catch {
      continue;
    }
    database.exec("BEGIN");
    try {
      for (const line of read.lines) {
        const row = rowOf(line, device);
        if (row) {
          insert.run(...KEYS.map((key) => row[key]));
        }
      }
      remember.run(file, stat.size, stat.mtimeMs, read.end);
      database.exec("COMMIT");
    } catch (error) {
      if (database.isTransaction) {
        database.exec("ROLLBACK");
      }
      report(error);
    }
  }
}

/** The catch-up running, which the next one waits for so no two read a file at once. */
let caughtUp: Promise<void> = Promise.resolve();

/** The index brought up to the files, ready to read. */
async function readable(): Promise<DatabaseSync | undefined> {
  const db = openStore();
  if (db) {
    const catchingUp = caughtUp.then(() => catchUpActivity(db));
    caughtUp = catchingUp.catch(() => undefined);
    await catchingUp;
  }
  return db;
}

function report(error: unknown) {
  if (reported) {
    return;
  }
  reported = true;
  getWorkspaceConfig().captureException(
    new Error("The activity log could not be written", { cause: error }),
  );
}

function totalOf(entry: ActivityEntry): null | number {
  if (entry.inputTokens == null && entry.outputTokens == null) {
    return null;
  }
  return (entry.inputTokens ?? 0) + (entry.outputTokens ?? 0);
}

/**
 * Records one request: a line in this device's file for the month, and a
 * row in the index. Never throws and never waits on the caller's behalf: a
 * record that cannot be written loses the row rather than slow or break the
 * request it describes.
 */
export function insertActivity(entry: ActivityEntry): void {
  const db = openStore();
  if (!db) {
    return;
  }
  const { deviceId, rootDir } = getWorkspaceConfig();
  const row: ActivityRow = {
    cacheReadTokens: entry.cacheReadTokens ?? null,
    cacheWriteTokens: entry.cacheWriteTokens ?? null,
    chatId: entry.chatId ?? null,
    connectionName: entry.connectionName ?? null,
    connectionType: entry.connectionType ?? null,
    device: deviceId,
    durationMs: entry.durationMs == null ? null : Math.round(entry.durationMs),
    error: entry.error ?? null,
    finishReason: entry.finishReason ?? null,
    id: ulid(entry.startedAt),
    imageQuality: entry.imageQuality ?? null,
    inputTokens: entry.inputTokens ?? null,
    kind: entry.kind,
    modelRequested: entry.modelRequested ?? null,
    modelServed: entry.modelServed ?? null,
    outputTokens: entry.outputTokens ?? null,
    purpose: entry.purpose,
    reasoningTokens: entry.reasoningTokens ?? null,
    responseId: entry.responseId ?? null,
    sessionId: entry.sessionId ?? null,
    startedAt: Math.round(entry.startedAt),
    status: entry.status,
    surface: entry.surface ?? null,
    totalTokens: totalOf(entry),
  };
  try {
    const file = activityFileOf(rootDir, deviceId, row.startedAt);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // oxlint-disable-next-line studio/no-sync-content-read -- synchronous on purpose: an async append needs a queue and a flush the quit waits for, and this device's own file, appended on every request, is rarely evicted.
    fs.appendFileSync(file, lineOf(row));
    db.prepare(INSERT_ROW).run(...KEYS.map((key) => row[key]));
  } catch (error) {
    report(error);
  }
}

/** When a line says its request started, or nothing for one that will not parse. */
function startOf(line: string): number | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    const at =
      typeof parsed === "object" && parsed !== null && "at" in parsed
        ? Date.parse(String(parsed.at))
        : Number.NaN;
    return Number.isNaN(at) ? undefined : at;
  } catch {
    return undefined;
  }
}

/**
 * Removes the requests this device made at or after `since`, or all of
 * them without it, from its own files and from the index, so the list reads
 * without them. Another device's files are that device's alone to write and
 * are left as they are. A month wholly in that time goes; the month it
 * starts in is written again with its earlier lines. Answers how many went
 * from the index.
 */
export async function clearOwnActivity(
  since?: number,
): Promise<{ removed: number }> {
  const { deviceId, rootDir } = getWorkspaceConfig();
  const from = since ?? Number.NEGATIVE_INFINITY;
  const own = activityFiles(rootDir).filter(
    ({ device, file }) => device === deviceId && monthEndOf(file) > from,
  );
  for (const { file } of own) {
    // Read once off the main thread, so a file a sync service had made
    // name-only is on disk before the synchronous pass below.
    await fs.promises.readFile(file).catch(() => undefined);
  }
  for (const { file } of own) {
    let text: string;
    try {
      // oxlint-disable-next-line studio/no-sync-content-read -- this device's own file, just read above; synchronous so no request appended meanwhile is lost
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const kept = text
      .split("\n")
      .filter((line) => (startOf(line) ?? Number.POSITIVE_INFINITY) < from);
    if (kept.length === 0) {
      fs.rmSync(file, { force: true });
    } else {
      const copy = `${file}.clearing`;
      fs.writeFileSync(copy, kept.map((line) => `${line}\n`).join(""));
      fs.renameSync(copy, file);
    }
  }
  const db = openStore();
  if (!db) {
    return { removed: 0 };
  }
  const forget = db.prepare("DELETE FROM activity_files WHERE path = ?");
  for (const { file } of own) {
    forget.run(file);
  }
  const removed = Number(
    db
      .prepare("DELETE FROM activity WHERE device = ? AND started_at >= ?")
      .run(deviceId, since ?? Number.MIN_SAFE_INTEGER).changes,
  );
  return { removed };
}

/** How many requests this device made at or after `since`, or ever without it. */
export async function countOwnActivity(since?: number): Promise<number> {
  const row = (await readable())
    ?.prepare(
      "SELECT count(*) AS count FROM activity WHERE device = ? AND started_at >= ?",
    )
    .get(getWorkspaceConfig().deviceId, since ?? Number.MIN_SAFE_INTEGER);
  return Number(row?.count ?? 0);
}

/** A WHERE clause and its parameters for the filters. */
function where(filter: ActivityFilter) {
  const clauses: string[] = [];
  const params: SQLInputValue[] = [];
  const anyOf = (expression: string, values: readonly string[] | undefined) => {
    if (!values || values.length === 0) {
      return;
    }
    clauses.push(`${expression} IN (${values.map(() => "?").join(", ")})`);
    params.push(...values);
  };
  for (const facet of ACTIVITY_FACETS) {
    anyOf(FACET_EXPRESSIONS[facet], filter[facet]);
  }
  if (filter.since !== undefined) {
    clauses.push("started_at >= ?");
    params.push(filter.since);
  }
  if (filter.until !== undefined) {
    clauses.push("started_at < ?");
    params.push(filter.until);
  }
  return {
    params,
    sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
  };
}

/** One page of rows under the filters, in the order asked for. */
export async function listActivity({
  filter,
  limit,
  offset,
  sort,
}: {
  filter: ActivityFilter;
  limit: number;
  offset: number;
  sort: ActivitySort;
}): Promise<ActivityRow[]> {
  const db = await readable();
  if (!db) {
    return [];
  }
  const { params, sql } = where(filter);
  const direction = sort.direction === "asc" ? "ASC" : "DESC";
  // Rows with nothing to sort by go last either way, and the id breaks ties
  // so a page boundary never repeats or skips a row.
  const rows = db
    .prepare(
      `SELECT ${SELECT_ROW} FROM activity ${sql} ORDER BY ${SORT_EXPRESSIONS[sort.column]} IS NULL, ${SORT_EXPRESSIONS[sort.column]} ${direction}, id ${direction} LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
  return rows.map((row) => ActivityRowSchema.parse(row));
}

/** One request by its id. */
export async function getActivity(
  id: string,
): Promise<ActivityRow | undefined> {
  const row = (await readable())
    ?.prepare(`SELECT ${SELECT_ROW} FROM activity WHERE id = ?`)
    .get(id);
  return row ? ActivityRowSchema.parse(row) : undefined;
}

const CSV_COLUMNS: [
  header: string,
  read: (row: ActivityRow) => null | number | string,
][] = [
  ["Started", (row) => new Date(row.startedAt).toISOString()],
  ["Duration (ms)", (row) => row.durationMs],
  ["Result", (row) => row.status],
  ["Type", (row) => row.kind],
  ["For", (row) => row.purpose],
  ["Chat", (row) => row.chatId],
  ["Session", (row) => row.sessionId],
  ["Surface", (row) => row.surface],
  ["Device", (row) => row.device],
  ["Connection", (row) => row.connectionName ?? row.connectionType],
  ["Model asked for", (row) => row.modelRequested],
  ["Model answered", (row) => row.modelServed],
  ["Image quality", (row) => row.imageQuality],
  ["Input tokens", (row) => row.inputTokens],
  ["Cache read tokens", (row) => row.cacheReadTokens],
  ["Cache write tokens", (row) => row.cacheWriteTokens],
  ["Output tokens", (row) => row.outputTokens],
  ["Reasoning tokens", (row) => row.reasoningTokens],
  ["Total tokens", (row) => row.totalTokens],
  ["Finish reason", (row) => row.finishReason],
  ["Error", (row) => row.error],
  ["Request ID", (row) => row.id],
  ["Response ID", (row) => row.responseId],
];

function csvCell(value: null | number | string): string {
  if (value === null) {
    return "";
  }
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Every row under the filters as CSV, newest first, with a header line. */
export async function activityCsv(filter: ActivityFilter): Promise<string> {
  const lines = [CSV_COLUMNS.map(([header]) => csvCell(header)).join(",")];
  const db = await readable();
  if (db) {
    const { params, sql } = where(filter);
    for (const row of db
      .prepare(
        `SELECT ${SELECT_ROW} FROM activity ${sql} ORDER BY started_at DESC, id DESC`,
      )
      .iterate(...params)) {
      const parsed = ActivityRowSchema.parse(row);
      lines.push(
        CSV_COLUMNS.map(([, read]) => csvCell(read(parsed))).join(","),
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

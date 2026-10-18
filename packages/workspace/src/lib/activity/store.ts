import { type DatabaseSync, type SQLInputValue } from "node:sqlite";
import { ulid } from "ulid";

import { getWorkspaceConfig } from "../workspace-config";
import { versionMatches, workspaceTables } from "../workspace-db";
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
 * The activity log: every model request the app made for the workspace, in
 * the `activity` table of its `workspace.db` on this computer. Unlike the
 * index beside it this is the only copy of what it holds, so a change to the
 * table migrates it rather than starting over.
 */
const ACTIVITY_VERSION = 1;

const COLUMNS = {
  cacheReadTokens: "cache_read_tokens",
  cacheWriteTokens: "cache_write_tokens",
  chatId: "chat_id",
  connectionId: "connection_id",
  connectionName: "connection_name",
  connectionType: "connection_type",
  durationMs: "duration_ms",
  error: "error",
  finishReason: "finish_reason",
  id: "id",
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

// The facets whose values are shown with their connection's mark.
const FACETS_WITH_CONNECTION_TYPE = new Set<ActivityFacet>([
  "connection",
  "model",
]);

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
 * Makes the activity table in a workspace's database where it is missing:
 * at first use, and before the activity an earlier build kept in its own
 * file moves in.
 */
export function makeActivityTable(database: DatabaseSync): void {
  database.exec("BEGIN");
  try {
    versionMatches(database, "activity", ACTIVITY_VERSION);
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
 * The served workspace's database with its activity table, or undefined
 * where there is nowhere to keep one (tests and scripts with no
 * `workspaceDbFile`) or it could not be opened, which leaves recording off.
 */
const openStore = workspaceTables((database) => {
  makeActivityTable(database);
  return database;
});

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
 * Stores one request. Never throws and never waits on the caller's behalf: a
 * record that cannot be written loses the row rather than slow or break the
 * request it describes.
 */
export function insertActivity(entry: ActivityEntry): void {
  const db = openStore();
  if (!db) {
    return;
  }
  const row: ActivityRow = {
    cacheReadTokens: entry.cacheReadTokens ?? null,
    cacheWriteTokens: entry.cacheWriteTokens ?? null,
    chatId: entry.chatId ?? null,
    connectionId: entry.connectionId ?? null,
    connectionName: entry.connectionName ?? null,
    connectionType: entry.connectionType ?? null,
    durationMs: entry.durationMs == null ? null : Math.round(entry.durationMs),
    error: entry.error ?? null,
    finishReason: entry.finishReason ?? null,
    id: ulid(entry.startedAt),
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
  const keys = Object.keys(COLUMNS) as (keyof ActivityRow)[]; // Object.keys widens to string[]
  try {
    db.prepare(
      `INSERT INTO activity (${keys.map((key) => COLUMNS[key]).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
    ).run(...keys.map((key) => row[key]));
  } catch (error) {
    report(error);
  }
}

/** A WHERE clause and its parameters for the filters, leaving out one field's own (for its facet counts). */
function where(filter: ActivityFilter, except?: ActivityFacet) {
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
    if (facet !== except) {
      anyOf(FACET_EXPRESSIONS[facet], filter[facet]);
    }
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
export function listActivity({
  filter,
  limit,
  offset,
  sort,
}: {
  filter: ActivityFilter;
  limit: number;
  offset: number;
  sort: ActivitySort;
}): ActivityRow[] {
  const db = openStore();
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
export function getActivity(id: string): ActivityRow | undefined {
  const row = openStore()
    ?.prepare(`SELECT ${SELECT_ROW} FROM activity WHERE id = ?`)
    .get(id);
  return row ? ActivityRowSchema.parse(row) : undefined;
}

type FacetEntry = {
  count: number;
  /** The connection kind behind a model or connection value, for its mark. */
  connectionType?: null | string;
  value: string;
};

/**
 * The totals under the filters, and for each field the values it can take
 * with how many rows have each, counted under every filter but that field's
 * own, so picking one value leaves its alternatives countable.
 */
export function summarizeActivity(filter: ActivityFilter) {
  const db = openStore();
  const facets = Object.fromEntries(
    ACTIVITY_FACETS.map((facet) => [facet, [] as FacetEntry[]]),
  ) as Record<ActivityFacet, FacetEntry[]>; // filled per facet below
  if (!db) {
    return { facets, requests: 0, tokens: 0 };
  }
  const { params, sql } = where(filter);
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS requests, COALESCE(SUM(total_tokens), 0) AS tokens FROM activity ${sql}`,
    )
    .get(...params) as { requests: number; tokens: number }; // an aggregate always returns its row
  for (const facet of ACTIVITY_FACETS) {
    const scoped = where(filter, facet);
    const expression = FACET_EXPRESSIONS[facet];
    const scopedWhere = scoped.sql
      ? `${scoped.sql} AND ${expression} IS NOT NULL`
      : `WHERE ${expression} IS NOT NULL`;
    facets[facet] = db
      .prepare(
        `SELECT ${expression} AS value, COUNT(*) AS count${FACETS_WITH_CONNECTION_TYPE.has(facet) ? ", MAX(connection_type) AS connectionType" : ""} FROM activity ${scopedWhere} GROUP BY value ORDER BY count DESC, value LIMIT 50`,
      )
      .all(...scoped.params) as FacetEntry[]; // the columns selected above
  }
  return { facets, requests: totals.requests, tokens: totals.tokens };
}

const CSV_COLUMNS: [
  header: string,
  read: (row: ActivityRow) => null | number | string,
][] = [
  ["Started", (row) => new Date(row.startedAt).toISOString()],
  ["Duration (ms)", (row) => row.durationMs],
  ["Result", (row) => row.status],
  ["Type", (row) => row.kind],
  ["Purpose", (row) => row.purpose],
  ["Chat", (row) => row.chatId],
  ["Session", (row) => row.sessionId],
  ["Surface", (row) => row.surface],
  ["Connection", (row) => row.connectionName ?? row.connectionType],
  ["Model asked for", (row) => row.modelRequested],
  ["Model answered", (row) => row.modelServed],
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
export function activityCsv(filter: ActivityFilter): string {
  const lines = [CSV_COLUMNS.map(([header]) => csvCell(header)).join(",")];
  const db = openStore();
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

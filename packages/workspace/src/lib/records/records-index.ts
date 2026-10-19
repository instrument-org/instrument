import fs from "node:fs/promises";
import path from "node:path";
import { type DatabaseSync, type StatementSync } from "node:sqlite";
import { z } from "zod";

import { type ChatId } from "../../schemas/chat-id";
import { createWriteQueue } from "../create-write-queue";
import { versionMatches } from "../workspace-db";
import { parseRecordFileName, type RecordFileName } from "./file-names";
import {
  compare,
  isForked,
  logPlace,
  settingPlace,
  type Place,
  rootHeader,
} from "./fold";
import {
  FILE_START,
  type ReadCursor,
  readLog,
  readSettings,
} from "./read-records";
import {
  type LogRecord,
  type SettingField,
  type SettingRecord,
  parseLogLine,
  RECORD_FORMAT,
  parseSettingLine,
  type SessionHeader,
} from "./record";
import { TAIL_BYTES, tailHash } from "./record-writer";

/**
 * The index of every chat's records, in `workspace.db`: what the chat list
 * and paging read without folding a chat, rebuilt from the record folders
 * whenever it is missing or its version changes.
 *
 * - `files`: each log and marks file as last read (size, modification
 *   time, a hash of its last bytes, how far it was folded, its last `seq`,
 *   whether it was downloaded), with what its own records decide: a log's
 *   header, the newest of each record that a newer one replaces, the
 *   messages it retracts. A file's row comes from its bytes alone.
 * - `messages`: each message a log holds records of, with where those
 *   records start and end in it, for reading a page of them. Its role and
 *   date are those of the log's newest record of the message itself, and
 *   none where the log holds only its parts.
 * - `sessions` and `chats`: what the files' rows come to together, by the
 *   fold's own rules (`fold.ts`), made again for a chat whenever a file of
 *   it changes.
 *
 * Bringing a chat up to date stats each of its files. A file whose size
 * and modification time are as last read is kept; one that grew, and still
 * ends its old length with the bytes it had, has only its new bytes folded;
 * any other (shorter, its old end changed, new, a conflict copy) is folded
 * from its start, its old rows dropped. Reading a file is what asks iCloud
 * for one it has not downloaded, so a file with bytes to fold is read
 * whatever its blocks on disk say; a file already folded to the size and
 * modification time it has is kept, and never asked for. A read that fails
 * on a file waiting for its download marks the file not downloaded, with
 * what it held before, and the next pass asks again.
 */

/**
 * The shape of the tables below. Any change to a table, or to what a row
 * means, bumps `INDEX_SHAPE` and every chat is folded again.
 *
 * The record format is part of it, because a row keeps record lines whose
 * meaning is `record.ts`'s: a header line stored under one format stops
 * parsing under the next, and a log whose header will not parse has its
 * offset advanced past records it then discards, which takes the chat out of
 * the index with nothing to put back. So the format carries the version with
 * it, and nobody has to remember that bumping one means bumping the other.
 */
const INDEX_SHAPE = 2;
const RECORDS_INDEX_VERSION = INDEX_SHAPE * 1000 + RECORD_FORMAT;

const TABLES = ["files", "messages", "sessions", "chats"];

/** A record a newer one replaces, as its line and where it sorts. */
const LatestSchema = z.object({
  line: z.string(),
  place: z.array(z.union([z.number(), z.string()])),
});

/** What one file's own records decide, as its `files` row keeps it. */
const FileFoldSchema = z.object({
  /** The highest `seq` after a log's header. */
  dataSeq: z.number(),
  /** A log's header, as its line. */
  header: z.string().optional(),
  /**
   * The newest record of each kind a newer one replaces: in a log
   * `rollover`, `stopped` and `state:<what>`; in a marks file
   * `<session> <field>`.
   */
  latest: z.record(z.string(), LatestSchema),
  /** The messages a log retracts, sorted. */
  retracted: z.array(z.string()),
  /** The newest `at` of a log's records. */
  updatedAt: z.number(),
});

type FileFold = z.output<typeof FileFoldSchema>;

const FileRowSchema = z.object({
  downloaded: z.number().transform((value) => value === 1),
  folded: z.string().transform((text, context): FileFold => {
    try {
      const value: unknown = JSON.parse(text);
      return FileFoldSchema.parse(value);
    } catch {
      context.addIssue({ code: "custom", message: "Not a file's fold" });
      return z.NEVER;
    }
  }),
  folded_offset: z.number(),
  last_seq: z.number(),
  mtime_ms: z.number(),
  name: z.string(),
  refused: z.string().nullable(),
  size: z.number(),
  skipped: z.number(),
  tail_hash: z.string(),
});

type FileRow = z.output<typeof FileRowSchema>;

/**
 * A file's fold as its row keeps it, its keys in one order, so the same
 * records give the same text however they were read.
 */
function serialize(folded: FileFold): string {
  return JSON.stringify({
    dataSeq: folded.dataSeq,
    header: folded.header,
    latest: Object.fromEntries(
      Object.entries(folded.latest).toSorted(([a], [b]) => (a < b ? -1 : 1)),
    ),
    retracted: folded.retracted,
    updatedAt: folded.updatedAt,
  });
}

interface MessageSpan {
  createdAt?: number;
  end: number;
  first: number;
  role?: string;
  session: string;
}

/** A file's new row, and the spans of the messages its newly folded bytes hold. */
interface FileUpdate {
  messages: Map<string, MessageSpan>;
  /** Whether the file was folded from its start, so its old message rows go. */
  refold: boolean;
  row: FileRow;
}

interface Statements {
  deleteChat: StatementSync;
  deleteChatSessions: StatementSync;
  deleteFile: StatementSync;
  deleteFileMessages: StatementSync;
  insertChat: StatementSync;
  insertSession: StatementSync;
  readFiles: StatementSync;
  upsertFile: StatementSync;
  upsertMessage: StatementSync;
}

const prepared = new WeakMap<DatabaseSync, Statements>();

/** One chat brought up to date at a time, so two never fold the same bytes. */
const chatQueue = createWriteQueue();

/**
 * Brings the index's rows for one chat up to date with its record folder,
 * `dir`. A folder that is gone takes the chat's rows with it.
 */
export function indexChat(
  database: DatabaseSync,
  chat: ChatId,
  dir: string,
): Promise<void> {
  return chatQueue(chat, async () => {
    const statements = prepare(database);
    // A row that does not parse is read as no row: its file is folded from
    // its start, or its row goes with it.
    const stored = new Set<string>();
    const known = new Map<string, FileRow>();
    for (const row of statements.readFiles.all(chat)) {
      if (typeof row.name === "string") {
        stored.add(row.name);
      }
      const parsed = FileRowSchema.safeParse(row);
      if (parsed.success) {
        known.set(parsed.data.name, parsed.data);
      }
    }
    const updates: FileUpdate[] = [];
    const present = new Set<string>();
    for (const name of await namesIn(dir)) {
      const parsed = parseRecordFileName(name);
      if (!parsed) {
        continue;
      }
      const update = await updateFile(
        path.join(dir, name),
        name,
        parsed,
        known.get(name),
      );
      if (update === "gone") {
        continue;
      }
      present.add(name);
      if (update !== "kept") {
        updates.push(update);
      }
    }
    const removed = [...stored].filter((name) => !present.has(name));
    if (updates.length === 0 && removed.length === 0) {
      return;
    }
    for (const update of updates) {
      known.set(update.row.name, update.row);
    }
    for (const name of removed) {
      known.delete(name);
    }
    const summary = summarize(known);
    transaction(database, () => {
      for (const name of removed) {
        statements.deleteFile.run(chat, name);
        statements.deleteFileMessages.run(chat, name);
      }
      for (const { messages, refold, row } of updates) {
        if (refold) {
          statements.deleteFileMessages.run(chat, row.name);
        }
        for (const [id, span] of messages) {
          statements.upsertMessage.run(
            chat,
            row.name,
            id,
            span.session,
            span.role ?? null,
            span.createdAt ?? null,
            span.first,
            span.end,
          );
        }
        statements.upsertFile.run(
          chat,
          row.name,
          row.size,
          row.mtime_ms,
          row.tail_hash,
          row.folded_offset,
          row.last_seq,
          row.downloaded ? 1 : 0,
          row.skipped,
          row.refused,
          serialize(row.folded),
        );
      }
      statements.deleteChatSessions.run(chat);
      for (const session of summary.sessions) {
        statements.insertSession.run(chat, ...session);
      }
      statements.deleteChat.run(chat);
      if (summary.chat) {
        statements.insertChat.run(chat, ...summary.chat);
      }
    });
  });
}

/**
 * The index's statements on this database, once its tables are made: on
 * the first use of a database, a version other than this build's drops
 * every index table and makes them again, empty, so each chat is folded
 * from its files the next time it is brought up to date. Nothing else in
 * the database is touched.
 */
function prepare(database: DatabaseSync): Statements {
  const known = prepared.get(database);
  if (known) {
    return known;
  }
  transaction(database, () => {
    if (!versionMatches(database, "records-index", RECORDS_INDEX_VERSION)) {
      for (const table of TABLES) {
        database.exec(`DROP TABLE IF EXISTS ${table}`);
      }
    }
    database.exec(`
      CREATE TABLE IF NOT EXISTS files (
        chat TEXT NOT NULL,
        name TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime_ms REAL NOT NULL,
        tail_hash TEXT NOT NULL,
        folded_offset INTEGER NOT NULL,
        last_seq INTEGER NOT NULL,
        downloaded INTEGER NOT NULL,
        skipped INTEGER NOT NULL,
        refused TEXT,
        folded TEXT NOT NULL,
        PRIMARY KEY (chat, name)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS messages (
        chat TEXT NOT NULL,
        file TEXT NOT NULL,
        id TEXT NOT NULL,
        session TEXT NOT NULL,
        role TEXT,
        created_at INTEGER,
        first_byte INTEGER NOT NULL,
        end_byte INTEGER NOT NULL,
        PRIMARY KEY (chat, file, id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS messages_by_session ON messages (chat, session, id);
      CREATE TABLE IF NOT EXISTS sessions (
        chat TEXT NOT NULL,
        id TEXT NOT NULL,
        parent TEXT,
        forked_at TEXT,
        handle TEXT,
        title TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        forked INTEGER NOT NULL,
        rollover TEXT,
        stopped TEXT,
        state TEXT NOT NULL,
        marks TEXT NOT NULL,
        retracted TEXT NOT NULL,
        PRIMARY KEY (chat, id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        session TEXT NOT NULL,
        title TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        starred INTEGER NOT NULL,
        archived INTEGER NOT NULL,
        unread TEXT,
        topic TEXT,
        tasks INTEGER NOT NULL
      ) STRICT;
    `);
  });
  const statements: Statements = {
    deleteChat: database.prepare("DELETE FROM chats WHERE id = ?"),
    deleteChatSessions: database.prepare("DELETE FROM sessions WHERE chat = ?"),
    deleteFile: database.prepare(
      "DELETE FROM files WHERE chat = ? AND name = ?",
    ),
    deleteFileMessages: database.prepare(
      "DELETE FROM messages WHERE chat = ? AND file = ?",
    ),
    insertChat: database.prepare(
      "INSERT INTO chats (id, session, title, created_at, updated_at, starred, archived, unread, topic, tasks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ),
    insertSession: database.prepare(
      "INSERT INTO sessions (chat, id, parent, forked_at, handle, title, created_at, updated_at, forked, rollover, stopped, state, marks, retracted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ),
    readFiles: database.prepare(
      "SELECT name, size, mtime_ms, tail_hash, folded_offset, last_seq, downloaded, skipped, refused, folded FROM files WHERE chat = ?",
    ),
    upsertFile: database.prepare(
      `INSERT INTO files (chat, name, size, mtime_ms, tail_hash, folded_offset, last_seq, downloaded, skipped, refused, folded) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat, name) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms, tail_hash = excluded.tail_hash, folded_offset = excluded.folded_offset, last_seq = excluded.last_seq, downloaded = excluded.downloaded, skipped = excluded.skipped, refused = excluded.refused, folded = excluded.folded`,
    ),
    upsertMessage: database.prepare(
      `INSERT INTO messages (chat, file, id, session, role, created_at, first_byte, end_byte) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat, file, id) DO UPDATE SET role = COALESCE(excluded.role, role), created_at = COALESCE(excluded.created_at, created_at), end_byte = excluded.end_byte`,
    ),
  };
  prepared.set(database, statements);
  return statements;
}

async function namesIn(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * What one file comes to now: kept as last read, gone (not a file any
 * more), or a new row with what its newly folded bytes hold.
 */
async function updateFile(
  file: string,
  name: string,
  parsed: RecordFileName,
  row: FileRow | undefined,
): Promise<"gone" | "kept" | FileUpdate> {
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(file);
  } catch {
    return "gone";
  }
  if (!stat.isFile()) {
    return "gone";
  }
  if (
    row &&
    row.size === stat.size &&
    row.mtime_ms === stat.mtimeMs &&
    row.downloaded
  ) {
    return "kept";
  }
  // A file iCloud has not downloaded reports the size it will have with no
  // blocks behind it. macOS alone is read that way: elsewhere a file whose
  // bytes live in its own metadata reports no blocks and is all there (NTFS
  // keeps one of a few hundred bytes inside its MFT record).
  const awaitingDownload =
    process.platform === "darwin" && stat.blocks === 0 && stat.size > 0;
  try {
    if (row && row.size <= stat.size) {
      const tailStart = Math.max(0, row.size - TAIL_BYTES);
      const start = Math.min(row.folded_offset, tailStart);
      const bytes = await readFrom(file, start, stat.size - start);
      if (
        start + bytes.length >= row.size &&
        tailHash(bytes.subarray(tailStart - start, row.size - start)) ===
          row.tail_hash
      ) {
        return fold(parsed, row, bytes.subarray(row.folded_offset - start), {
          mtimeMs: stat.mtimeMs,
          size: start + bytes.length,
          tail: tailHash(bytes),
        });
      }
    }
    const bytes = await readFrom(file, 0, stat.size);
    return {
      ...fold(parsed, unread(name), bytes, {
        mtimeMs: stat.mtimeMs,
        size: bytes.length,
        tail: tailHash(bytes),
      }),
      refold: true,
    };
  } catch (error) {
    if (!awaitingDownload) {
      throw error;
    }
    // The read asked for the download and it did not arrive, as it cannot
    // offline. The file keeps what it held, and the next pass asks again.
    return {
      messages: new Map(),
      refold: false,
      row: { ...(row ?? unread(name)), downloaded: false },
    };
  }
}

/** The row of a file nothing of has been read. */
function unread(name: string): FileRow {
  return {
    downloaded: true,
    folded: { dataSeq: 0, latest: {}, retracted: [], updatedAt: 0 },
    folded_offset: FILE_START.offset,
    last_seq: FILE_START.lastSeq,
    mtime_ms: 0,
    name,
    refused: null,
    size: 0,
    skipped: 0,
    tail_hash: tailHash(new Uint8Array()),
  };
}

async function readFrom(
  file: string,
  start: number,
  length: number,
): Promise<Uint8Array> {
  const handle = await fs.open(file, "r");
  try {
    const bytes = Buffer.alloc(Math.max(0, length));
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, start);
    return bytes.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Folds a file's bytes from its row's cursor on into a new row: `bytes` is
 * the file from that cursor. A refused file stays refused, as a fold keeps
 * it.
 */
function fold(
  parsed: RecordFileName,
  row: FileRow,
  bytes: Uint8Array,
  file: { mtimeMs: number; size: number; tail: string },
): FileUpdate {
  const cursor: ReadCursor = {
    lastSeq: row.last_seq,
    offset: row.folded_offset,
  };
  const folded: FileFold = {
    ...row.folded,
    latest: { ...row.folded.latest },
  };
  const messages = new Map<string, MessageSpan>();
  const next: FileRow = {
    ...row,
    downloaded: true,
    folded,
    mtime_ms: file.mtimeMs,
    size: file.size,
    tail_hash: file.tail,
  };
  const update = { messages, refold: false, row: next };
  if (row.refused !== null) {
    return update;
  }
  if (parsed.kind === "settings") {
    const read = readSettings(bytes, cursor);
    for (const { line, record } of read.records) {
      keepNewest(
        folded,
        `${record.session} ${record.field}`,
        line,
        settingPlace(record, line),
      );
    }
    next.folded_offset = read.cursor.offset;
    next.last_seq = read.cursor.lastSeq;
    next.skipped += read.skipped;
    return update;
  }
  const read = readLog(bytes, cursor);
  if (read.kind === "refused") {
    next.refused = read.reason;
    return update;
  }
  let header =
    folded.header === undefined ? undefined : headerOf(folded.header);
  const first = read.records[0];
  if (header === undefined && first?.record.t === "session") {
    if (
      first.record.id !== parsed.session ||
      first.record.device !== parsed.device
    ) {
      next.refused = "header-names-another-log";
      return update;
    }
    header = first.record;
    folded.header = first.line;
  }
  next.folded_offset = read.cursor.offset;
  next.last_seq = read.cursor.lastSeq;
  next.skipped += read.skipped;
  if (header === undefined) {
    return update;
  }
  const retracted = new Set(folded.retracted);
  for (const { line, offset, record } of read.records) {
    const span = { end: offset + Buffer.byteLength(line) + 1, first: offset };
    folded.updatedAt = Math.max(folded.updatedAt, record.at.getTime());
    if (record.t !== "session") {
      folded.dataSeq = Math.max(folded.dataSeq, record.seq);
    }
    const place = logPlace(header, parsed.stem, record, line);
    switch (record.t) {
      case "session":
        break;
      case "message":
        spanMessage(messages, record.message.id, header.id, span, {
          createdAt: record.message.metadata.createdAt.getTime(),
          role: record.message.role,
        });
        break;
      case "part":
        spanMessage(messages, record.part.metadata.messageId, header.id, span);
        break;
      case "retract":
        for (const id of record.messages) {
          retracted.add(id);
        }
        break;
      case "rollover":
      case "stopped":
        keepNewest(folded, record.t, line, place);
        break;
      case "state":
        keepNewest(folded, `state:${record.what}`, line, place);
        break;
    }
  }
  folded.retracted = [...retracted].toSorted();
  return update;
}

function headerOf(line: string): SessionHeader | undefined {
  const record = parseLogLine(line);
  return record?.t === "session" ? record : undefined;
}

function spanMessage(
  messages: Map<string, MessageSpan>,
  id: string,
  session: string,
  span: { end: number; first: number },
  snapshot?: { createdAt: number; role: string },
): void {
  const known = messages.get(id);
  messages.set(id, {
    ...known,
    ...snapshot,
    end: span.end,
    first: known?.first ?? span.first,
    session,
  });
}

function keepNewest(
  folded: FileFold,
  key: string,
  line: string,
  place: Place,
): void {
  const current = folded.latest[key];
  if (!current || compare(current.place, place) < 0) {
    folded.latest[key] = { line, place: [...place] };
  }
}

type SQLValue = null | number | string;

interface Summary {
  chat?: SQLValue[];
  sessions: SQLValue[][];
}

interface SessionParts {
  dataSeqs: Map<string, number>;
  headers: Map<string, { header: SessionHeader; place: Place }>;
  latest: Map<string, { line: string; place: Place }>;
  marks: Map<string, { line: string; place: Place }>;
  retracted: Set<string>;
  updatedAt: number;
}

/**
 * The `sessions` and `chats` rows a chat's files come to together: per
 * session, the newest of each replaced record across its logs, its marks
 * across every device's marks file, and what its logs' headers say of
 * where it began and whether it forked.
 */
function summarize(files: ReadonlyMap<string, FileRow>): Summary {
  const sessions = new Map<string, SessionParts>();
  const partsOf = (id: string): SessionParts => {
    const known = sessions.get(id);
    if (known) {
      return known;
    }
    const parts: SessionParts = {
      dataSeqs: new Map(),
      headers: new Map(),
      latest: new Map(),
      marks: new Map(),
      retracted: new Set(),
      updatedAt: 0,
    };
    sessions.set(id, parts);
    return parts;
  };
  for (const [name, row] of files) {
    const parsed = parseRecordFileName(name);
    if (!parsed || row.refused !== null) {
      continue;
    }
    if (parsed.kind === "settings") {
      for (const [key, latest] of Object.entries(row.folded.latest)) {
        const [session = "", field = ""] = key.split(" ");
        newest(partsOf(session).marks, field, latest);
      }
      continue;
    }
    const line = row.folded.header;
    const header = line === undefined ? undefined : headerOf(line);
    if (line === undefined || header === undefined) {
      continue;
    }
    const parts = partsOf(header.id);
    const place = logPlace(header, parsed.stem, header, line);
    const current = parts.headers.get(parsed.stem);
    if (!current || compare(current.place, place) < 0) {
      parts.headers.set(parsed.stem, { header, place });
    }
    parts.dataSeqs.set(
      parsed.stem,
      Math.max(parts.dataSeqs.get(parsed.stem) ?? 0, row.folded.dataSeq),
    );
    parts.updatedAt = Math.max(parts.updatedAt, row.folded.updatedAt);
    for (const [key, latest] of Object.entries(row.folded.latest)) {
      newest(parts.latest, key, latest);
    }
    for (const id of row.folded.retracted) {
      parts.retracted.add(id);
    }
  }

  const summaries = [...sessions.values()]
    .flatMap((parts) => {
      const summary = sessionSummary(parts);
      return summary ? [summary] : [];
    })
    .toSorted((a, b) => compare([a.header.id], [b.header.id]));
  const own = summaries.find(({ header }) => header.parent === undefined);
  return {
    ...(own && {
      chat: [
        own.header.id,
        own.marks.title?.value.text ?? null,
        own.header.createdAt.getTime(),
        Math.max(...summaries.map(({ updatedAt }) => updatedAt)),
        own.marks.starred?.value ? 1 : 0,
        own.marks.archived?.value ? 1 : 0,
        own.marks.unread?.value ? JSON.stringify(own.marks.unread.value) : null,
        own.marks.topic?.value ?? null,
        summaries.filter(({ header }) => header.parent === own.header.id)
          .length,
      ],
    }),
    sessions: summaries.map(({ row }) => row),
  };
}

type Marks = { [F in SettingField]?: Extract<SettingRecord, { field: F }> };

/** A session's row, from its parts, or none until a log of it has its header read. */
function sessionSummary(
  parts: SessionParts,
):
  | { header: SessionHeader; marks: Marks; row: SQLValue[]; updatedAt: number }
  | undefined {
  const headers = new Map(
    [...parts.headers].map(([stem, { header }]) => [stem, header]),
  );
  const header = rootHeader(headers);
  if (!header) {
    return undefined;
  }
  const latest = new Map(
    [...parts.latest].flatMap(([key, { line }]): [string, LogRecord][] => {
      const record = parseLogLine(line);
      return record ? [[key, record]] : [];
    }),
  );
  const rollover = latest.get("rollover");
  const stopped = latest.get("stopped");
  const state: Record<string, unknown> = {};
  for (const key of [...latest.keys()].toSorted()) {
    const record = latest.get(key);
    if (
      record?.t === "state" &&
      record.value !== null &&
      record.value !== undefined
    ) {
      state[record.what] = record.value;
    }
  }
  const marks = settingsOf(parts.marks);
  return {
    header,
    marks,
    row: [
      header.id,
      header.parent ?? null,
      header.forkedAt ?? null,
      header.handle ?? null,
      header.title ?? null,
      header.createdAt.getTime(),
      parts.updatedAt,
      isForked(headers, parts.dataSeqs) ? 1 : 0,
      rollover?.t === "rollover"
        ? JSON.stringify({
            after: rollover.after,
            ...(rollover.usableTokens === undefined
              ? {}
              : { usableTokens: rollover.usableTokens }),
          })
        : null,
      stopped?.t === "stopped"
        ? JSON.stringify({ at: stopped.at.toISOString(), by: stopped.by })
        : null,
      JSON.stringify(state),
      JSON.stringify(
        Object.fromEntries(
          Object.values(marks)
            .toSorted((a, b) => (a.field < b.field ? -1 : 1))
            .map((mark) => [
              mark.field,
              { at: mark.at.toISOString(), value: mark.value },
            ]),
        ),
      ),
      JSON.stringify([...parts.retracted].toSorted()),
    ],
    updatedAt: parts.updatedAt,
  };
}

/** The newest mark of each field, from the lines that won. */
function settingsOf(
  latest: Map<string, { line: string; place: Place }>,
): Marks {
  const marks: Marks = {};
  for (const { line } of latest.values()) {
    const record = parseSettingLine(line);
    if (!record) {
      continue;
    }
    switch (record.field) {
      case "archived":
        marks.archived = record;
        break;
      case "model":
        marks.model = record;
        break;
      case "starred":
        marks.starred = record;
        break;
      case "stoppedAt":
        marks.stoppedAt = record;
        break;
      case "title":
        marks.title = record;
        break;
      case "topic":
        marks.topic = record;
        break;
      case "unread":
        marks.unread = record;
        break;
    }
  }
  return marks;
}

function newest(
  map: Map<string, { line: string; place: Place }>,
  key: string,
  latest: { line: string; place: Place },
): void {
  const current = map.get(key);
  if (!current || compare(current.place, latest.place) < 0) {
    map.set(key, latest);
  }
}

function transaction(database: DatabaseSync, run: () => void): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    run();
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) {
      database.exec("ROLLBACK");
    }
    throw error;
  }
}

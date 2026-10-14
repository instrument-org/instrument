import { createHash } from "node:crypto";

import { type ChatId } from "../../schemas/chat-id";
import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { type StoreId } from "../../schemas/store-id";
import { type DeviceId } from "./device-id";
import { parseRecordFileName } from "./file-names";
import {
  FILE_START,
  type ReadCursor,
  readLog,
  readMarks,
} from "./read-records";
import {
  type LogRecord,
  type MarkField,
  type MarkRecord,
  type SessionHeader,
  type ToldWhat,
} from "./record";

/**
 * Folding a chat: reading every log and marks file in its record folder,
 * conflict copies included, into its sessions, their messages and parts.
 *
 * - The newest snapshot of a message, a part, a rollover, a stop, or each
 *   thing a session was told wins. Messages are ordered by id, parts by id
 *   under their message.
 * - A retract drops its messages and their parts, wherever it is read.
 * - A record is placed after everything its writer had read: within a log
 *   by `seq`, and across logs from the log's header, which lists every log
 *   of the session its writer had read and how far. A record's place starts
 *   at the sum of those counts plus its own `seq`, so it is always past
 *   every record it came after.
 * - Records whose writers had not read each other's (two devices that
 *   carried a session on side by side) still sort by place, then by `at`,
 *   then by log: the same way on every device, if not the way they
 *   happened. The session is flagged as forked, and keeps both.
 * - A record is the same record when its log, place and line are, so a
 *   conflict copy folds once however often it arrives.
 * - The person's marks merge across devices: the newest `at` per session
 *   and field, ties to the larger device id, and a title the app may still
 *   change never over one that settled.
 *
 * A fold takes each file as it grows, from where it last stopped, and comes
 * to the same chat however the files and their bytes arrived. A session is
 * built again only once a record of its own, or a mark on it, arrives.
 */

/** The newest of each of a session's marks, as the person made it. */
export type FoldedMarks = {
  [F in MarkField]?: Omit<Extract<MarkRecord, { field: F }>, "seq">;
};

export interface FoldedSession {
  chat: ChatId;
  createdAt: Date;
  /** Whether two devices each carried the session on past what the other had read; `messages` holds both. */
  forked: boolean;
  forkedAt?: StoreId.Message;
  handle?: string;
  id: StoreId.Session;
  marks: FoldedMarks;
  /** The session's own messages, oldest first, each with its parts. */
  messages: SessionMessage.WithParts[];
  parent?: StoreId.Session;
  rollover?: { after: StoreId.Message; usableTokens?: number };
  /**
   * The newest stop. It applies until a message that starts a turn comes
   * after it, which the conversation says.
   */
  stopped?: { at: Date; by: "app" | "chat" | "user" };
  title?: string;
  /** What the session was last told of each, leaving out what was cleared. */
  told: Partial<Record<ToldWhat, unknown>>;
  /** When the session's newest record was written. */
  updatedAt: Date;
  /**
   * The device that wrote the newest snapshot of each of the session's
   * messages and their parts, by message or part id.
   */
  writtenBy: ReadonlyMap<string, DeviceId>;
}

export interface FoldedChat {
  /** By id. */
  sessions: FoldedSession[];
}

/** Where a record sorts among the session's records it competes with; later is newer. */
export type Place = readonly (number | string)[];

interface Newest<T> {
  place: Place;
  value: T;
}

/** A snapshot, with the device whose log holds it. */
interface Written<T> {
  device: DeviceId;
  value: T;
}

interface SessionState {
  headers: Map<string, Newest<SessionHeader>>;
  messages: Map<string, Newest<Written<SessionMessage.Type>>>;
  parts: Map<string, Newest<Written<SessionMessagePart.Type>>>;
  retracted: Set<string>;
  rollover?: Newest<NonNullable<FoldedSession["rollover"]>>;
  /** The highest `seq` of each log, of any record and of records after its header. */
  seqs: Map<string, { data: number; last: number }>;
  stopped?: Newest<NonNullable<FoldedSession["stopped"]>>;
  told: Map<ToldWhat, Newest<unknown>>;
  updatedAt: number;
}

type MarkState = {
  [F in MarkField]?: Newest<Extract<MarkRecord, { field: F }>>;
};

interface FileState {
  cursor: ReadCursor;
  /** A log's header, read with its first line, which places its records. */
  header?: SessionHeader;
  refused?: "header-names-another-log" | "no-session-header";
  skipped: number;
}

export class ChatFold {
  /** The chat as last built, until anything new is folded. */
  #chat: FoldedChat | undefined;
  #files = new Map<string, FileState>();
  /** Each session as last built, until a record of its own or a mark on it arrives. */
  #folded = new Map<string, FoldedSession>();
  #marks = new Map<string, MarkState>();
  /** Every record folded so far, so a copy of one folds once. */
  #seen = new Set<string>();
  #sessions = new Map<string, SessionState>();

  /** Where the next read of a file starts: the file's start until it has been read. */
  cursor(name: string): ReadCursor {
    return this.#files.get(name)?.cursor ?? FILE_START;
  }

  /**
   * Folds a file from its cursor on: `bytes` is the file from there, so the
   * whole file the first time and what it has grown by after. A name that is
   * not a log or a marks file is left alone.
   */
  add(name: string, bytes: Uint8Array): void {
    const parsed = parseRecordFileName(name);
    if (!parsed) {
      return;
    }
    const file = this.#files.get(name) ?? { cursor: FILE_START, skipped: 0 };
    this.#files.set(name, file);
    if (file.refused) {
      return;
    }
    if (parsed.kind === "marks") {
      const read = readMarks(bytes, file.cursor);
      file.cursor = read.cursor;
      file.skipped += read.skipped;
      for (const { line, record } of read.records) {
        this.#addMark(record, line);
      }
      return;
    }
    const read = readLog(bytes, file.cursor);
    if (read.kind === "refused") {
      file.refused = read.reason;
      return;
    }
    const first = read.records[0]?.record;
    if (file.header === undefined && first?.t === "session") {
      if (first.id !== parsed.session || first.device !== parsed.device) {
        file.refused = "header-names-another-log";
        return;
      }
      file.header = first;
    }
    file.cursor = read.cursor;
    file.skipped += read.skipped;
    const { header } = file;
    if (header === undefined) {
      return;
    }
    for (const { line, record } of read.records) {
      this.#addLogRecord(header, parsed.stem, record, line);
    }
  }

  /** Files whose reading skipped lines or refused them, for a log of what was lost. */
  problems(): { name: string; refused?: string; skipped: number }[] {
    return [...this.#files]
      .filter(([, file]) => file.refused !== undefined || file.skipped > 0)
      .map(([name, { refused, skipped }]) => ({
        name,
        ...(refused && { refused }),
        skipped,
      }));
  }

  /**
   * What a log of the session that this device starts now carries on from:
   * every log of it folded so far, with the last `seq` read of each, and
   * what their headers say their writers had read.
   */
  continuesFor(session: StoreId.Session): Record<string, number> {
    const state = this.#sessions.get(session);
    const read = new Map<string, number>();
    for (const [stem, { value }] of state?.headers ?? []) {
      raise(read, stem, state?.seqs.get(stem)?.last ?? 0);
      for (const [other, seq] of Object.entries(value.continues ?? {})) {
        raise(read, other, seq);
      }
    }
    return Object.fromEntries(
      [...read].toSorted(([a], [b]) => compare([a], [b])),
    );
  }

  /**
   * The chat as the records folded so far say it is. A session nothing new
   * was folded for since the last call is the same object it was then.
   */
  chat(): FoldedChat {
    if (this.#chat) {
      return this.#chat;
    }
    const sessions: FoldedSession[] = [];
    for (const [id, state] of this.#sessions) {
      const built = this.#folded.get(id) ?? this.#build(id, state);
      if (built) {
        sessions.push(built);
      }
    }
    this.#chat = {
      sessions: sessions.toSorted((a, b) => compare([a.id], [b.id])),
    };
    return this.#chat;
  }

  #build(id: string, state: SessionState): FoldedSession | undefined {
    const header = rootHeader(headersOf(state));
    if (!header) {
      return undefined;
    }
    const built = folded(header, state, this.#marks.get(id) ?? {});
    this.#folded.set(id, built);
    return built;
  }

  /** Forgets what was built of a session, which something new was folded for. */
  #changed(session: string): void {
    this.#chat = undefined;
    this.#folded.delete(session);
  }

  #addLogRecord(
    header: SessionHeader,
    stem: string,
    record: LogRecord,
    line: string,
  ): void {
    const place = logPlace(header, stem, record, line);
    if (!this.#firstSight(`${header.id} ${place.join(" ")}`)) {
      return;
    }
    this.#changed(header.id);
    const state = this.#session(header.id);
    const seqs = state.seqs.get(stem) ?? { data: 0, last: -1 };
    state.seqs.set(stem, {
      data:
        record.t === "session" ? seqs.data : Math.max(seqs.data, record.seq),
      last: Math.max(seqs.last, record.seq),
    });
    state.updatedAt = Math.max(state.updatedAt, record.at.getTime());
    switch (record.t) {
      case "session":
        keepNewest(state.headers, stem, record, place);
        break;
      case "message":
        keepNewest(
          state.messages,
          record.message.id,
          { device: header.device, value: record.message },
          place,
        );
        break;
      case "part":
        keepNewest(
          state.parts,
          record.part.metadata.id,
          { device: header.device, value: record.part },
          place,
        );
        break;
      case "retract":
        for (const id of record.messages) {
          state.retracted.add(id);
        }
        break;
      case "rollover":
        state.rollover = newer(
          state.rollover,
          {
            after: record.after,
            ...(record.usableTokens === undefined
              ? {}
              : { usableTokens: record.usableTokens }),
          },
          place,
        );
        break;
      case "stopped":
        state.stopped = newer(
          state.stopped,
          { at: record.at, by: record.by },
          place,
        );
        break;
      case "told":
        keepNewest(state.told, record.what, record.value, place);
        break;
    }
  }

  #addMark(record: MarkRecord, line: string): void {
    const place = markPlace(record, line);
    if (!this.#firstSight(`mark ${place.join(" ")}`)) {
      return;
    }
    this.#changed(record.session);
    const marks = this.#marks.get(record.session) ?? {};
    this.#marks.set(record.session, marks);
    switch (record.field) {
      case "title":
        marks.title = newer(marks.title, record, place);
        break;
      case "starred":
        marks.starred = newer(marks.starred, record, place);
        break;
      case "archived":
        marks.archived = newer(marks.archived, record, place);
        break;
      case "unread":
        marks.unread = newer(marks.unread, record, place);
        break;
      case "topics":
        marks.topics = newer(marks.topics, record, place);
        break;
      case "stoppedAt":
        marks.stoppedAt = newer(marks.stoppedAt, record, place);
        break;
    }
  }

  #firstSight(key: string): boolean {
    if (this.#seen.has(key)) {
      return false;
    }
    this.#seen.add(key);
    return true;
  }

  #session(id: string): SessionState {
    const existing = this.#sessions.get(id);
    if (existing) {
      return existing;
    }
    const state: SessionState = {
      headers: new Map(),
      messages: new Map(),
      parts: new Map(),
      retracted: new Set(),
      seqs: new Map(),
      told: new Map(),
      updatedAt: 0,
    };
    this.#sessions.set(id, state);
    return state;
  }
}

/**
 * Where a log's record sorts among its session's records: past everything
 * its writer had read (the sum of its header's `continues`, plus its own
 * `seq`), then by `at`, then by log, then by its line, so a copy of a record
 * sorts where the record does and two records never tie.
 */
export function logPlace(
  header: SessionHeader,
  stem: string,
  record: LogRecord,
  line: string,
): Place {
  const base = sum(Object.values(header.continues ?? {}));
  return [
    base + record.seq,
    record.at.getTime(),
    stem,
    record.seq,
    digest(line),
  ];
}

/**
 * Where a mark sorts among the marks of its session and field: a title that
 * settled after one that may still change, then the newest `at`, then the
 * larger device id.
 */
export function markPlace(record: MarkRecord, line: string): Place {
  const settled = record.field === "title" && record.value.settled ? 1 : 0;
  return [
    settled,
    record.at.getTime(),
    record.device,
    record.seq,
    digest(line),
  ];
}

/** Folds a chat's files from scratch. */
export function foldChat(
  files: Iterable<{ bytes: Uint8Array; name: string }>,
): FoldedChat {
  const fold = new ChatFold();
  for (const { bytes, name } of files) {
    fold.add(name, bytes);
  }
  return fold.chat();
}

/**
 * A session's history as the model reads it: a task's starts with its
 * parent's history up to and including the message it was forked at, then
 * goes on with its own messages.
 */
export function historyOf(
  chat: FoldedChat,
  session: StoreId.Session,
): SessionMessage.WithParts[] {
  const history = (
    id: StoreId.Session,
    visited: Set<string>,
  ): SessionMessage.WithParts[] => {
    const found = chat.sessions.find((candidate) => candidate.id === id);
    if (!found || visited.has(id)) {
      return [];
    }
    visited.add(id);
    const { forkedAt, parent } = found;
    const inherited =
      parent === undefined || forkedAt === undefined
        ? []
        : history(parent, visited).filter((message) => message.id <= forkedAt);
    return [...inherited, ...found.messages];
  };
  return history(session, new Set());
}

function folded(
  header: SessionHeader,
  state: SessionState,
  marks: MarkState,
): FoldedSession {
  const told: FoldedSession["told"] = {};
  for (const what of [...state.told.keys()].toSorted()) {
    const value = state.told.get(what)?.value;
    if (value !== null && value !== undefined) {
      told[what] = value;
    }
  }
  const { messages, writtenBy } = messagesOf(state);
  return {
    chat: header.chat,
    createdAt: header.createdAt,
    forked: isForked(
      headersOf(state),
      new Map([...state.seqs].map(([stem, { data }]) => [stem, data])),
    ),
    ...(header.forkedAt === undefined ? {} : { forkedAt: header.forkedAt }),
    ...(header.handle === undefined ? {} : { handle: header.handle }),
    id: header.id,
    marks: foldedMarks(marks),
    messages,
    ...(header.parent === undefined ? {} : { parent: header.parent }),
    ...(state.rollover && { rollover: state.rollover.value }),
    ...(state.stopped && { stopped: state.stopped.value }),
    ...(header.title === undefined ? {} : { title: header.title }),
    told,
    updatedAt: new Date(state.updatedAt),
    writtenBy,
  };
}

function messagesOf(state: SessionState): {
  messages: SessionMessage.WithParts[];
  writtenBy: Map<string, DeviceId>;
} {
  const parts = new Map<string, Written<SessionMessagePart.Type>[]>();
  for (const { value } of state.parts.values()) {
    const list = parts.get(value.value.metadata.messageId) ?? [];
    list.push(value);
    parts.set(value.value.metadata.messageId, list);
  }
  const writtenBy = new Map<string, DeviceId>();
  const messages = [...state.messages.values()]
    .map(({ value }) => value)
    .filter(({ value }) => !state.retracted.has(value.id))
    .toSorted((a, b) => compare([a.value.id], [b.value.id]))
    .map(({ device, value: message }) => {
      writtenBy.set(message.id, device);
      const own = (parts.get(message.id) ?? []).toSorted((a, b) =>
        compare([a.value.metadata.id], [b.value.metadata.id]),
      );
      for (const part of own) {
        writtenBy.set(part.value.metadata.id, part.device);
      }
      return { ...message, parts: own.map(({ value }) => value) };
    });
  return { messages, writtenBy };
}

function foldedMarks(marks: MarkState): FoldedMarks {
  return {
    ...(marks.archived && { archived: made(marks.archived.value) }),
    ...(marks.starred && { starred: made(marks.starred.value) }),
    ...(marks.stoppedAt && { stoppedAt: made(marks.stoppedAt.value) }),
    ...(marks.title && { title: made(marks.title.value) }),
    ...(marks.topics && { topics: made(marks.topics.value) }),
    ...(marks.unread && { unread: made(marks.unread.value) }),
  };
}

function headersOf(state: SessionState): Map<string, SessionHeader> {
  return new Map([...state.headers].map(([stem, { value }]) => [stem, value]));
}

/** A mark as the person made it, apart from where in its file it is. */
function made<M extends MarkRecord>({ seq: _seq, ...mark }: M): Omit<M, "seq"> {
  return mark;
}

/**
 * The header that names the session: the log it began in, which carries on
 * from nothing. Every log of a session repeats the same session fields, so
 * any header stands in until that log is read.
 */
export function rootHeader(
  headers: ReadonlyMap<string, SessionHeader>,
): SessionHeader | undefined {
  let root: { header: SessionHeader; place: Place } | undefined;
  for (const [stem, value] of headers) {
    const continues = Object.values(value.continues ?? {});
    const place = [continues.length, sum(continues), stem];
    if (!root || compare(place, root.place) < 0) {
      root = { header: value, place };
    }
  }
  return root?.header;
}

/**
 * Whether two logs each hold records past what the other's writer had read
 * of it: two devices that carried the session on side by side.
 */
export function isForked(
  headers: ReadonlyMap<string, SessionHeader>,
  /** The highest `seq` after its header in each log. */
  dataSeqs: ReadonlyMap<string, number>,
): boolean {
  const stems = [...headers.keys()];
  const readBy = new Map(stems.map((stem) => [stem, readOf(headers, stem)]));
  const unread = (stem: string, reader: string) =>
    (dataSeqs.get(stem) ?? 0) > (readBy.get(reader)?.get(stem) ?? 0);
  return stems.some((a) =>
    stems.some((b) => a < b && unread(a, b) && unread(b, a)),
  );
}

/**
 * How far a log's writer had read each other log of the session: what its
 * header says, and what the headers of the logs it read say in turn.
 */
function readOf(
  headers: ReadonlyMap<string, SessionHeader>,
  stem: string,
  visited = new Set<string>(),
): Map<string, number> {
  visited.add(stem);
  const read = new Map<string, number>();
  const continues = headers.get(stem)?.continues ?? {};
  for (const [other, seq] of Object.entries(continues)) {
    raise(read, other, seq);
    if (!visited.has(other)) {
      for (const [deeper, deeperSeq] of readOf(headers, other, visited)) {
        raise(read, deeper, deeperSeq);
      }
    }
  }
  return read;
}

function keepNewest<K, T>(
  map: Map<K, Newest<T>>,
  key: K,
  value: T,
  place: Place,
): void {
  map.set(key, newer(map.get(key), value, place));
}

function newer<T>(
  current: Newest<T> | undefined,
  value: T,
  place: Place,
): Newest<T> {
  return current && compare(current.place, place) >= 0
    ? current
    : { place, value };
}

/** Which of two places is later: positive when `a` is. */
export function compare(a: Place, b: Place): number {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const left = a[index];
    const right = b[index];
    if (left === right) {
      continue;
    }
    if (left === undefined) {
      return -1;
    }
    if (right === undefined) {
      return 1;
    }
    return left < right ? -1 : 1;
  }
  return 0;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function raise(map: Map<string, number>, key: string, value: number): void {
  map.set(key, Math.max(map.get(key) ?? value, value));
}

function digest(line: string): string {
  return createHash("sha256").update(line).digest("base64url");
}

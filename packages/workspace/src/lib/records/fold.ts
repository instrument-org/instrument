import { createHash } from "node:crypto";
import { type Stopper } from "../../schemas/stop-notice";

import { type ChatId } from "../../schemas/chat-id";
import {
  type CardAnswer,
  type PermissionCard,
} from "../../schemas/permission-card";
import { type Session } from "../../schemas/session";
import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { type StoreId } from "../../schemas/store-id";
import { type DeviceId } from "./device-id";
import { parseRecordFileName } from "./file-names";
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
  type SessionHeader,
} from "./record";

/**
 * Folding a chat: reading every log and settings file in its record folder,
 * conflict copies included, into its sessions, their messages and parts.
 *
 * - The newest snapshot of a message, a part, a rollover, a stop, or each
 *   thing a session was told wins, and so does a permission card's.
 *   Messages are ordered by id, parts by id under their message. Every
 *   answer to a card is kept, in place order, since the first one wins.
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
 * - Settings merge across devices: the newest `at` per session and field,
 *   ties to the larger device id, and a title the app may still change
 *   never over one that settled.
 *
 * A fold takes each file as it grows, from where it last stopped, and comes
 * to the same chat however the files and their bytes arrived. A session is
 * built again only once a record of its own, or a setting on it, arrives.
 */

/** The newest of each of a session's settings, as it was set. */
export type FoldedSettings = {
  [F in SettingField]?: Omit<Extract<SettingRecord, { field: F }>, "seq">;
};

export interface FoldedSession {
  /** The app version that began the session, from the header of its first log. */
  app: string;
  /**
   * The newest title the app gave the session. The app writes every name it
   * gives as a title it may still change, and settles one with a second
   * line of the same words; the user's rename is one settled line.
   */
  appTitle?: string;
  chat: ChatId;
  createdAt: Date;
  /** Whether two devices each carried the session on past what the other had read; `messages` holds both. */
  forked: boolean;
  forkedAt?: StoreId.Message;
  handle?: string;
  id: StoreId.Session;
  settings: FoldedSettings;
  /** The session's own messages, oldest first, each with its parts. */
  messages: SessionMessage.WithParts[];
  parent?: StoreId.Session;
  rollover?: {
    after: StoreId.Message;
    usableTokens?: number;
    windows?: Session.RolloverWindows;
  };
  /**
   * The newest stop. It applies until a message that starts a turn comes
   * after it, which the conversation says.
   */
  stopped?: { at: Date; by: Stopper };
  /** The hosts the session's browser has been on, from its newest `sites` record. */
  sites?: string[];
  /** The permission cards raised in the session's log, each as its newest `card` record has it. */
  cards?: PermissionCard[];
  /** Every `answer` record to a card, from every device, in log order. */
  answers?: CardAnswer[];
  /** The title the session was started with: a task's name, a chat's opening words. */
  startedAs?: string;
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
  sites?: Newest<string[]>;
  stopped?: Newest<NonNullable<FoldedSession["stopped"]>>;
  cards: Map<string, Newest<PermissionCard>>;
  answers: Newest<CardAnswer>[];
  updatedAt: number;
}

type SettingState = {
  [F in SettingField]?: Newest<Extract<SettingRecord, { field: F }>>;
} & {
  /** The words of the newest title line the app may still change. */
  appTitle?: Newest<string>;
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
  /** Each session as last built, until a record of its own or a setting on it arrives. */
  #folded = new Map<string, FoldedSession>();
  #settings = new Map<string, SettingState>();
  /** Every record folded so far, so a copy of one folds once. */
  #seen = new Set<string>();
  #sessions = new Map<string, SessionState>();
  readonly #readPart: (
    part: SessionMessagePart.Type,
  ) => SessionMessagePart.Type;

  /**
   * `readPart` turns a part as its log keeps it into the part a reader is
   * handed (`part-paths.ts`); none hands it over as kept.
   */
  constructor(
    readPart: (part: SessionMessagePart.Type) => SessionMessagePart.Type = (
      part,
    ) => part,
  ) {
    this.#readPart = readPart;
  }

  /** Where the next read of a file starts: the file's start until it has been read. */
  cursor(name: string): ReadCursor {
    return this.#files.get(name)?.cursor ?? FILE_START;
  }

  /**
   * Folds a file from its cursor on: `bytes` is the file from there, so the
   * whole file the first time and what it has grown by after. A name that is
   * not a log or a settings file is left alone.
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
    if (parsed.kind === "settings") {
      const read = readSettings(bytes, file.cursor);
      file.cursor = read.cursor;
      file.skipped += read.skipped;
      for (const { line, record } of read.records) {
        this.#addSetting(record, line);
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
  continuesFor(id: StoreId.Session): Record<string, number> {
    const session = this.#sessions.get(id);
    const read = new Map<string, number>();
    for (const [stem, { value }] of session?.headers ?? []) {
      raise(read, stem, session?.seqs.get(stem)?.last ?? 0);
      for (const [other, seq] of Object.entries(value.continues ?? {})) {
        raise(read, other, seq);
      }
    }
    return Object.fromEntries(
      [...read].toSorted(([a], [b]) => compare([a], [b])),
    );
  }

  /** How far each file has been read, by name: what the chat as folded was read from. */
  readTo(): Map<string, number> {
    return new Map(
      [...this.#files].map(([name, file]) => [name, file.cursor.offset]),
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
    for (const [id, session] of this.#sessions) {
      const built = this.#folded.get(id) ?? this.#build(id, session);
      if (built) {
        sessions.push(built);
      }
    }
    this.#chat = {
      sessions: sessions.toSorted((a, b) => compare([a.id], [b.id])),
    };
    return this.#chat;
  }

  #build(id: string, session: SessionState): FoldedSession | undefined {
    const header = rootHeader(headersOf(session));
    if (!header) {
      return undefined;
    }
    const built = folded(header, session, this.#settings.get(id) ?? {});
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
    const session = this.#session(header.id);
    const seqs = session.seqs.get(stem) ?? { data: 0, last: -1 };
    session.seqs.set(stem, {
      data:
        record.t === "session" ? seqs.data : Math.max(seqs.data, record.seq),
      last: Math.max(seqs.last, record.seq),
    });
    session.updatedAt = Math.max(session.updatedAt, record.at.getTime());
    switch (record.t) {
      case "session":
        keepNewest(session.headers, stem, record, place);
        break;
      case "message":
        keepNewest(
          session.messages,
          record.message.id,
          { device: header.device, value: record.message },
          place,
        );
        break;
      case "part":
        keepNewest(
          session.parts,
          record.part.metadata.id,
          { device: header.device, value: this.#readPart(record.part) },
          place,
        );
        break;
      case "retract":
        for (const id of record.messages) {
          session.retracted.add(id);
        }
        break;
      case "rollover":
        session.rollover = newer(
          session.rollover,
          {
            after: record.after,
            ...(record.usableTokens === undefined
              ? {}
              : { usableTokens: record.usableTokens }),
            ...(record.windows === undefined
              ? {}
              : { windows: record.windows }),
          },
          place,
        );
        break;
      case "stop":
        session.stopped = newer(
          session.stopped,
          { at: record.at, by: record.by },
          place,
        );
        break;
      case "sites":
        session.sites = newer(session.sites, record.visited, place);
        break;
      case "card":
        keepNewest(session.cards, record.card.id, record.card, place);
        break;
      case "answer":
        session.answers.push({
          place,
          value: {
            at: record.at,
            card: record.card,
            decision: record.decision,
            device: header.device,
            ...(record.session !== undefined && { session: record.session }),
          },
        });
        break;
    }
  }

  #addSetting(record: SettingRecord, line: string): void {
    const place = settingPlace(record, line);
    if (!this.#firstSight(`set ${place.join(" ")}`)) {
      return;
    }
    this.#changed(record.session);
    const settings = this.#settings.get(record.session) ?? {};
    this.#settings.set(record.session, settings);
    switch (record.field) {
      case "title":
        settings.title = newer(settings.title, record, place);
        if (record.value.auto) {
          settings.appTitle = newer(
            settings.appTitle,
            record.value.text,
            place,
          );
        }
        break;
      case "starred":
        settings.starred = newer(settings.starred, record, place);
        break;
      case "archived":
        settings.archived = newer(settings.archived, record, place);
        break;
      case "unread":
        settings.unread = newer(settings.unread, record, place);
        break;
      case "topic":
        settings.topic = newer(settings.topic, record, place);
        break;
      case "model":
        settings.model = newer(settings.model, record, place);
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
    const session: SessionState = {
      answers: [],
      cards: new Map(),
      headers: new Map(),
      messages: new Map(),
      parts: new Map(),
      retracted: new Set(),
      seqs: new Map(),
      updatedAt: 0,
    };
    this.#sessions.set(id, session);
    return session;
  }
}

/**
 * Where a log's record sorts among its session's records: past everything
 * its writer had read (the sum of its header's `continues`, plus its own
 * `seq`), then by `at`, then by log, then by its line, so a copy of a record
 * sorts where the record does and two records never tie.
 */
function logPlace(
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
 * Where a setting sorts among the settings of its session and field: a title
 * that settled after one the app may still change, then the newest `at`,
 * then the larger device id.
 */
function settingPlace(record: SettingRecord, line: string): Place {
  const settled = record.field === "title" && !record.value.auto ? 1 : 0;
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
  session: SessionState,
  settings: SettingState,
): FoldedSession {
  const { messages, writtenBy } = messagesOf(session);
  return {
    app: header.app,
    ...(settings.appTitle && { appTitle: settings.appTitle.value }),
    chat: header.chat,
    createdAt: header.createdAt,
    forked: isForked(
      headersOf(session),
      new Map([...session.seqs].map(([stem, { data }]) => [stem, data])),
    ),
    ...(header.forkedAt === undefined ? {} : { forkedAt: header.forkedAt }),
    ...(header.handle === undefined ? {} : { handle: header.handle }),
    id: header.id,
    settings: foldedSettings(settings),
    messages,
    ...(header.parent === undefined ? {} : { parent: header.parent }),
    ...(session.rollover && { rollover: session.rollover.value }),
    ...(session.sites && { sites: session.sites.value }),
    ...(session.cards.size > 0 && {
      cards: [...session.cards.values()].map(({ value }) => value),
    }),
    ...(session.answers.length > 0 && {
      answers: session.answers
        .toSorted((a, b) => compare(a.place, b.place))
        .map(({ value }) => value),
    }),
    ...(session.stopped && { stopped: session.stopped.value }),
    ...(header.startedAs === undefined ? {} : { startedAs: header.startedAs }),
    updatedAt: new Date(session.updatedAt),
    writtenBy,
  };
}

function messagesOf(session: SessionState): {
  messages: SessionMessage.WithParts[];
  writtenBy: Map<string, DeviceId>;
} {
  const parts = new Map<string, Written<SessionMessagePart.Type>[]>();
  for (const { value } of session.parts.values()) {
    const list = parts.get(value.value.metadata.messageId) ?? [];
    list.push(value);
    parts.set(value.value.metadata.messageId, list);
  }
  const writtenBy = new Map<string, DeviceId>();
  const messages = [...session.messages.values()]
    .map(({ value }) => value)
    .filter(({ value }) => !session.retracted.has(value.id))
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

function foldedSettings(settings: SettingState): FoldedSettings {
  return {
    ...(settings.archived && { archived: made(settings.archived.value) }),
    ...(settings.model && { model: made(settings.model.value) }),
    ...(settings.starred && { starred: made(settings.starred.value) }),
    ...(settings.title && { title: made(settings.title.value) }),
    ...(settings.topic && { topic: made(settings.topic.value) }),
    ...(settings.unread && { unread: made(settings.unread.value) }),
  };
}

function headersOf(session: SessionState): Map<string, SessionHeader> {
  return new Map(
    [...session.headers].map(([stem, { value }]) => [stem, value]),
  );
}

/** A setting as it was set, apart from where in its file it is. */
function made<M extends SettingRecord>({
  seq: _seq,
  ...setting
}: M): Omit<M, "seq"> {
  return setting;
}

/**
 * The header that names the session: the log it began in, which carries on
 * from nothing. Every log of a session repeats the same session fields, so
 * any header stands in until that log is read.
 */
function rootHeader(
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
function isForked(
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

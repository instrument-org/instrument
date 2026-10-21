import fs from "node:fs/promises";
import { type Stopper } from "../../../schemas/stop-notice";
import path from "node:path";
import { parallel } from "radashi";
import { z } from "zod";

import { CHAT_DB_FILE_NAME } from "../../../constants";
import { type ChatId, ChatIdSchema } from "../../../schemas/chat-id";
import { Session } from "../../../schemas/session";
import { type SessionMessagePart } from "../../../schemas/session/message-part";
import { isToolPart } from "../../is-tool-part";
import { blobPath, isBlobName, writeBlob } from "../blobs";
import { type DeviceId } from "../device-id";
import {
  logFileName,
  settingsFileName,
  parseRecordFileName,
} from "../file-names";
import { ChatFold, type FoldedSession } from "../fold";
import { partFromRecord, partToRecord, type SaveBlob } from "../part-blobs";
import { type LogRecord, type SettingRecord, RECORD_FORMAT } from "../record";
import {
  chatRecordFormat,
  RecordWriter,
  type Unsequenced,
} from "../record-writer";
import { readLog, readSettings } from "../read-records";
import { syncDirectory } from "../sync-directory";
import {
  addDifference,
  addDifferences,
  datesKept,
  type Difference,
  MAX_DIFFERENCES,
} from "./compare";
import {
  type ChatDbPart,
  type ChatDbRead,
  type ChatDbSession,
  type ChatDbSessionRow,
  readChatDb,
} from "./read-chat-db";

/**
 * Turning a chat's `chat.db` into records: a log per session, the sessions'
 * settings, and a blob for each file a tool returned, all from this device.
 *
 * Each part is written as its row held it rather than as reading it gave, so
 * a payload this build cannot read is in the line as it was written and a
 * build that learns its shape can read it. `chat.db` is set aside and later
 * deleted, which makes the line the only copy left.
 *
 * The records are written into a folder in the chat's record folder that
 * sync engines skip (`.~convert-<pid>.tmp`), synced to disk, and folded back
 * to be compared with what `chat.db` held. Only when every session, message
 * and part reads back the same is the folder renamed to say so
 * (`.~converted-<pid>.tmp`), and its files moved out of it into place;
 * anything else removes it and leaves the chat as it was. `chat.db` is read
 * through a copy and never changed: moving it out of the folder is for the
 * caller, once the chat says it is converted.
 *
 * Safe to run again: a run cut off while writing left only a folder to
 * remove, and one cut off while moving files into place left a renamed
 * folder whose moves the next run finishes.
 *
 * What the folder holds already decides whether the chat converts at all
 * (`recordsThere`). Records from another device are never written over. This
 * device's own are read: a log holding only its header, and settings, say no
 * more than the session rows they came from, which is what a conversion cut
 * off partway leaves. Those are removed and written again from `chat.db`, so
 * the chat ends up as a first conversion would have left it. Records holding
 * messages, parts or a retraction are a history of their own, and the
 * comparison with `chat.db` says whether they are a conversion that already
 * ran or turns a build took before one did.
 *
 * Each record's `at` is when the session was last updated, which is all
 * `chat.db` says of when anything was written, and is the newest record's
 * `at` a fold reads as the session's `updatedAt`. A setting's `at` is the date
 * `chat.db` kept for it (`starredAt`, `titleSettledAt`) where it kept one.
 */

export interface ConvertOptions {
  /** The app version, which each log's header names. */
  app: string;
  /** The device the records are from. */
  deviceId: DeviceId;
}

/** What converting a chat wrote, and what it read that has no record. */
interface Converted {
  blobBytes: number;
  blobs: number;
  /** Rows no read of `chat.db` takes, by the first segment of their key. */
  leftBehind: Record<string, number>;
  /** The size of every log and the settings file together. */
  logBytes: number;
  messages: number;
  parts: number;
  sessions: number;
  /** Tool calls a process left in flight, written as interrupted. */
  swept: number;
}

export type ChatConversion =
  | {
      kind: "already-converted";
      /** `chat.db` and the files beside it, to move out of the folder. */
      store: string[];
    }
  | { converted: Converted; kind: "converted"; store: string[] }
  /** The records would not read back as `chat.db` does. */
  | { differences: Difference[]; kind: "different" }
  | { error: string; kind: "failed" }
  /**
   * The records this device wrote hold a history that is not what `chat.db`
   * says, which only a build that took turns on the chat before converting it
   * leaves. Neither file stands for the whole chat, and nothing here can tell
   * which part of each is the newer, so the chat keeps `chat.db` and is said
   * back rather than merged.
   */
  | { differences: Difference[]; kind: "half-written" }
  | { kind: "no-store" }
  /** `chat.db` cannot be read as the store read it. */
  | { error: string; kind: "unreadable" };

export interface WorkspaceConversion {
  chats: ({ dir: string } & ChatConversion)[];
  /** Whether every chat that has a `chat.db` holds records now. */
  complete: boolean;
  counts: Record<ChatConversion["kind"], number>;
}

const WORKING = /^\.~convert-\d+\.tmp$/;
const COMMITTED = /^\.~converted-\d+\.tmp$/;

/** Where in the working folder `chat.db` is copied to be read. */
const SOURCE = "source";

const STORE_SUFFIXES = ["", "-wal", "-shm", "-journal"];

/**
 * How many chats convert at once. Each spends most of its time waiting on
 * the disk to sync, which several waiting together share.
 */
const CHATS_AT_ONCE = 8;

/** Converts every chat in a workspace's chats folder. */
export async function convertWorkspaceChats(
  chatsDir: string,
  options: ConvertOptions,
): Promise<WorkspaceConversion> {
  const dirs = (await fs.readdir(chatsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => path.join(chatsDir, entry.name))
    .toSorted();
  const chats: WorkspaceConversion["chats"] = await parallel(
    { limit: CHATS_AT_ONCE },
    dirs,
    async (dir) => ({ dir, ...(await convertChat(dir, options)) }),
  );
  const counts: WorkspaceConversion["counts"] = {
    "already-converted": 0,
    converted: 0,
    different: 0,
    failed: 0,
    "half-written": 0,
    "no-store": 0,
    unreadable: 0,
  };
  for (const chat of chats) {
    counts[chat.kind] += 1;
  }
  return {
    chats,
    complete:
      counts.different +
        counts.failed +
        counts["half-written"] +
        counts.unreadable ===
      0,
    counts,
  };
}

/** Converts the chat whose record folder is `chatDir`. */
export async function convertChat(
  chatDir: string,
  options: ConvertOptions,
): Promise<ChatConversion> {
  try {
    await recover(chatDir);
    const store = await storeFiles(chatDir);
    if (store.length === 0) {
      return { kind: "no-store" };
    }
    const there = await recordsThere(chatDir, options.deviceId);
    const chat = ChatIdSchema.safeParse(path.basename(chatDir));
    if (!chat.success) {
      return {
        error: `${path.basename(chatDir)} is not a chat id: ${z.prettifyError(chat.error)}`,
        kind: "failed",
      };
    }
    return await convert(chatDir, chat.data, store, there, options);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      kind: "failed",
    };
  }
}

async function convert(
  chatDir: string,
  chat: ChatId,
  store: string[],
  there: Extract<RecordsThere, { kind: "history" | "restating" }>,
  options: ConvertOptions,
): Promise<ChatConversion> {
  const work = path.join(chatDir, `.~convert-${process.pid}.tmp`);
  await fs.mkdir(work);
  let committed = false;
  try {
    const read = await readChatDb(
      path.join(chatDir, CHAT_DB_FILE_NAME),
      path.join(work, SOURCE),
    );
    await fs.rm(path.join(work, SOURCE), { force: true, recursive: true });
    if (read.kind === "unreadable") {
      return read;
    }
    if (there.kind === "history") {
      // Either the records hold the whole chat -- this ran before and only
      // `chat.db` was left to move, or the chat was written through the
      // records from its first message -- or a build wrote turns into them
      // over a history only `chat.db` holds, which no merge can answer for.
      const missing = await sameShape(chatDir, read);
      return missing.length === 0
        ? { kind: "already-converted", store }
        : { differences: missing, kind: "half-written" };
    }
    // The files a bridge wrote beside the store before this ran carry the
    // names a conversion writes and say no more than the session rows do, so
    // they go and `chat.db` is written out whole. Before anything is written,
    // so a run cut off here leaves the chat as it was before the app read it.
    for (const file of there.restating) {
      await fs.rm(file, { force: true });
    }
    const written = await writeRecords(work, chat, read, options);
    const differences = [
      ...written.refused,
      ...(await verify(work, read)),
    ].slice(0, MAX_DIFFERENCES);
    if (differences.length > 0) {
      return { differences, kind: "different" };
    }
    const done = path.join(chatDir, `.~converted-${process.pid}.tmp`);
    await fs.rename(work, done);
    committed = true;
    await syncDirectory(chatDir);
    const sizes = await sizesIn(done);
    await moveIntoPlace(chatDir, done);
    return {
      converted: {
        ...sizes,
        leftBehind: read.leftBehind,
        messages: written.messages,
        parts: written.parts,
        sessions: read.sessions.length,
        swept: read.swept,
      },
      kind: "converted",
      store,
    };
  } finally {
    if (!committed) {
      await fs.rm(work, { force: true, recursive: true });
    }
  }
}

/** Clears what a run cut off left: a working folder, or moves not finished. */
async function recover(chatDir: string): Promise<void> {
  for (const name of await fs.readdir(chatDir)) {
    if (COMMITTED.test(name)) {
      await moveIntoPlace(chatDir, path.join(chatDir, name));
    } else if (WORKING.test(name)) {
      await fs.rm(path.join(chatDir, name), { force: true, recursive: true });
    }
  }
}

/** `chat.db` and the files beside it, or nothing when there is no `chat.db`. */
async function storeFiles(chatDir: string): Promise<string[]> {
  const db = path.join(chatDir, CHAT_DB_FILE_NAME);
  if (!(await exists(db))) {
    return [];
  }
  const files: string[] = [];
  for (const suffix of STORE_SUFFIXES) {
    if (await exists(`${db}${suffix}`)) {
      files.push(`${db}${suffix}`);
    }
  }
  return files;
}

/** What a chat's record folder holds already, which says whether it converts. */
type RecordsThere =
  /** Records holding messages, parts or a retraction, whichever device wrote them. */
  | { kind: "history" }
  /**
   * Nothing, or no more than a restatement of the session rows, with this
   * device's own among them: the files it removes and writes again from
   * `chat.db`.
   */
  | { kind: "restating"; restating: string[] };

/** The records a session row restates, which a conversion writes from it. */
const RESTATED = new Set(["rollover", "session", "set", "sites", "stop"]);

/**
 * Which device wrote a record does not say whether the records hold the
 * conversation, so it does not decide this. A file that holds a history is a
 * history whoever wrote it, and the comparison that follows folds the whole
 * folder, so a chat whose records came from another computer is checked
 * against `chat.db` the same way one written here is: the records hold
 * everything the database holds, or the database stays.
 *
 * What the device does decide is which files may be removed and written
 * again. Only this device's own restatement is, since every other file is its
 * own writer's, and the conversion's own log is written under this device's
 * name beside them.
 */
async function recordsThere(
  chatDir: string,
  device: DeviceId,
): Promise<RecordsThere> {
  const restating: string[] = [];
  let history = false;
  for (const name of (await fs.readdir(chatDir)).toSorted()) {
    const parsed = parseRecordFileName(name);
    if (!parsed) {
      continue;
    }
    const file = path.join(chatDir, name);
    if (!(await restatesOnly(file, parsed.kind))) {
      history = true;
    } else if (parsed.device === device) {
      restating.push(file);
    }
  }
  return history ? { kind: "history" } : { kind: "restating", restating };
}

/**
 * Whether every record in a file says no more than the session row it came
 * from: its header, a setting, where its context was reset, who stopped its
 * turn, what standing facts it holds. A whole line this build cannot read counts for a
 * history, so a file holding anything unaccounted for is left alone rather
 * than written over.
 *
 * Read the way every other reader reads these files, which leaves the bytes
 * after the last newline for the next read. A run cut off mid-append leaves
 * a fragment there, and reading it as a line of its own made the chat a
 * history of unreadable records: it kept its database, was listed
 * unavailable, and failed the same way at every launch after.
 */
async function restatesOnly(
  file: string,
  kind: "log" | "settings",
): Promise<boolean> {
  const bytes = await fs.readFile(file);
  const read =
    kind === "settings" ? readSettings(bytes) : logRecordsOf(readLog(bytes));
  return (
    read !== undefined &&
    read.skipped === 0 &&
    read.records.every(({ record }) => RESTATED.has(record.t))
  );
}

/** A log's records, or none for a file that is not a log to read at all. */
function logRecordsOf(read: ReturnType<typeof readLog>) {
  return read.kind === "read" ? read : undefined;
}

interface Written {
  messages: number;
  parts: number;
  /** Records the writer would not write, since they would not read back. */
  refused: Difference[];
}

async function writeRecords(
  work: string,
  chat: ChatId,
  read: Extract<ChatDbRead, { kind: "read" }>,
  options: ConvertOptions,
): Promise<Written> {
  const written: Written = { messages: 0, parts: 0, refused: [] };
  const save = (bytes: Uint8Array, mediaType: string) =>
    writeBlob(work, bytes, mediaType);
  const settings: Unsequenced<SettingRecord>[] = [];
  for (const entry of read.sessions) {
    const name = logFileName(entry.session.id, options.deviceId);
    written.refused.push(
      ...(await writeFile(
        path.join(work, name),
        "log",
        await logRecords(chat, entry, options, save),
      )),
    );
    settings.push(...settingsOf(entry.session, options.deviceId));
    written.messages += entry.messages.length;
    written.parts += entry.messages.reduce(
      (total, { parts }) => total + parts.length,
      0,
    );
  }
  if (settings.length > 0) {
    written.refused.push(
      ...(await writeFile(
        path.join(work, settingsFileName(options.deviceId)),
        "settings",
        settings,
      )),
    );
  }
  await syncDirectory(work);
  return written;
}

/** Writes a file's records in order, syncs it, and says which it refused. */
async function writeFile(
  file: string,
  kind: "log" | "settings",
  records: Unsequenced<LogRecord | SettingRecord>[],
): Promise<Difference[]> {
  const writer = new RecordWriter(file, chatRecordFormat(kind, file), {
    bytes: new Uint8Array(),
    lastSeq: -1,
  });
  const appended = await Promise.allSettled(
    records.map((record) => writer.append(record)),
  );
  await writer.commit();
  const refused: Difference[] = [];
  for (const [index, result] of appended.entries()) {
    const record = records[index];
    if (result.status === "rejected" && record) {
      addDifference(
        refused,
        `${path.basename(file)} ${whereIs(record)}`,
        "a record",
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason),
      );
    }
  }
  return refused;
}

/** When the session was last updated: every record's `at`. */
function lastUpdate(session: Session.Type): Date {
  return session.updatedAt ?? session.createdAt;
}

/**
 * The stop a session row says, as a `stopped` record holds it: who ended a
 * task's turn (`stoppedBy`), at the session's last update, which is all the
 * row says of when; else the user's Stop on the chat's own turn
 * (`stoppedAt`), at the moment it was pressed.
 */
function stopOf(
  session: ChatDbSessionRow,
): { at: Date; by: Stopper } | undefined {
  if (session.stoppedBy !== undefined) {
    return { at: lastUpdate(session), by: session.stoppedBy };
  }
  return session.stoppedAt === undefined
    ? undefined
    : { at: session.stoppedAt, by: "person" };
}

/**
 * The session row as the records keep it, for comparing with what they fold
 * to: a stop is who made it, the moment a Stop was pressed is that record's
 * `at`, and the newest record's `at` is when the session was last updated.
 */
function asRecordsKeepIt(row: ChatDbSessionRow): Session.Type {
  const stop = stopOf(row);
  const { stoppedAt: _stoppedAt, ...session } = row;
  const updated = lastUpdate(session);
  return {
    ...session,
    ...(stop && { stoppedBy: stop.by }),
    updatedAt: stop && stop.at > updated ? stop.at : updated,
  };
}

/**
 * A session's log: its header, each message followed by its parts, then
 * where its context was last reset, who stopped it, and the sites its
 * browser had been on.
 */
async function logRecords(
  chat: ChatId,
  { messages, session, sites }: ChatDbSession,
  { app, deviceId }: ConvertOptions,
  save: SaveBlob,
): Promise<Unsequenced<LogRecord>[]> {
  const at = lastUpdate(session);
  const records: Unsequenced<LogRecord>[] = [
    {
      t: "session",
      at,
      format: RECORD_FORMAT,
      id: session.id,
      chat,
      createdAt: session.createdAt,
      device: deviceId,
      app,
      ...(session.parentId === undefined
        ? {}
        : { parent: session.parentId, title: session.title }),
      ...(session.forkedAtMessageId === undefined
        ? {}
        : { forkedAt: session.forkedAtMessageId }),
      ...(session.handle === undefined ? {} : { handle: session.handle }),
    },
  ];
  for (const { message, parts } of messages) {
    records.push({ t: "message", at, message });
    for (const part of parts) {
      records.push({ t: "part", at, part: await partRecord(part, save) });
    }
  }
  if (session.rolledOverAfterMessageId !== undefined) {
    records.push({
      t: "rollover",
      at,
      after: session.rolledOverAfterMessageId,
      ...(session.rolledOverUnderUsableTokens === undefined
        ? {}
        : { usableTokens: session.rolledOverUnderUsableTokens }),
    });
  }
  const stop = stopOf(session);
  if (stop) {
    records.push({ t: "stop", ...stop });
  }
  if (sites !== undefined) {
    records.push({ t: "sites", at, visited: sites });
  }
  return records;
}

/**
 * The part a log keeps: the row `chat.db` held, with the bytes in its output
 * moved into a blob. The row rather than the read of it, because a read
 * stands in for whatever it cannot make sense of -- a payload of a type no
 * schema here has, or one written before a field its schema now describes,
 * comes back as `data-unknown` saying so, and a failed call's `rawInput`
 * folds into `input`. Reading the line back gives the read's answer again,
 * since a record and the store go through the same schema.
 */
async function partRecord(
  { part, stored }: ChatDbPart,
  save: SaveBlob,
): Promise<SessionMessagePart.Type> {
  const written = await partToRecord(part, save);
  const swapped: { output?: unknown } =
    written !== part && isToolPart(written) ? { output: written.output } : {};
  // The row's own payload, which no type here describes once its shape has
  // retired: the same reason reading one is a cast rather than a parse.
  return { ...stored, ...swapped } as SessionMessagePart.Type;
}

/**
 * A session's settings. A chat's own session always has a title setting; a
 * task's title is in its log's header, and is a setting only once it
 * settled.
 */
function settingsOf(
  session: Session.Type,
  device: DeviceId,
): Unsequenced<SettingRecord>[] {
  const at = lastUpdate(session);
  const of = { t: "set", session: session.id, device } as const;
  const settings: Unsequenced<SettingRecord>[] = [];
  if (session.parentId === undefined || session.titleSettledAt !== undefined) {
    settings.push({
      ...of,
      at: session.titleSettledAt ?? at,
      field: "title",
      value: {
        auto: session.titleSettledAt === undefined,
        text: session.title,
      },
    });
  }
  if (session.starredAt !== undefined) {
    settings.push({
      ...of,
      at: session.starredAt,
      field: "starred",
      value: true,
    });
  }
  if (session.archivedAt !== undefined) {
    settings.push({
      ...of,
      at: session.archivedAt,
      field: "archived",
      value: true,
    });
  }
  if (session.unreadAt !== undefined) {
    settings.push({
      ...of,
      at: session.unreadAt,
      field: "unread",
      value: session.unreadByUser === true ? "marked" : "new",
    });
  }
  if (session.topic !== undefined) {
    settings.push({ ...of, at, field: "topic", value: session.topic });
  }
  return settings;
}

/** The session row a folded session stands for, as `chat.db` kept it. */
function sessionRow(folded: FoldedSession): unknown {
  const { rollover, settings } = folded;
  const title = settings.title;
  const unread = settings.unread;
  return {
    createdAt: folded.createdAt,
    id: folded.id,
    title: title?.value.text ?? folded.title,
    updatedAt: folded.updatedAt,
    ...(folded.parent === undefined ? {} : { parentId: folded.parent }),
    ...(folded.forkedAt === undefined
      ? {}
      : { forkedAtMessageId: folded.forkedAt }),
    ...(folded.handle === undefined ? {} : { handle: folded.handle }),
    ...(title?.value.auto === false ? { titleSettledAt: title.at } : {}),
    ...(settings.starred?.value === true
      ? { starredAt: settings.starred.at }
      : {}),
    ...(settings.archived?.value === true
      ? { archivedAt: settings.archived.at }
      : {}),
    ...(unread?.value ? { unreadAt: unread.at } : {}),
    ...(unread?.value === "marked" ? { unreadByUser: true } : {}),
    ...(settings.topic?.value ? { topic: settings.topic.value } : {}),
    ...(rollover === undefined
      ? {}
      : {
          rolledOverAfterMessageId: rollover.after,
          ...(rollover.usableTokens === undefined
            ? {}
            : { rolledOverUnderUsableTokens: rollover.usableTokens }),
        }),
    ...(folded.stopped ? { stoppedBy: folded.stopped.by } : {}),
  };
}

/**
 * Where the records already in a chat's folder do not cover what `chat.db`
 * holds: every session, each one's messages in order, and each message's
 * parts. A conversion wrote all of them at once from one read, so it covers
 * every one; so does a chat whose every message went through the records as
 * it was written. Records may go on past `chat.db`, since a chat used after
 * its conversion takes turns and starts tasks only there: more sessions,
 * messages after its own, and parts beside its own. A log a writer beside
 * the store began part way through a chat is missing the messages written
 * before it, which is what this finds.
 *
 * Ids and their order, and no more: reading `chat.db` again stamps a call a
 * process left in flight with the moment of that read
 * (`sweepInterruptedToolCalls`), so no two reads of such a chat agree field
 * for field. The conversion's own verification is the field-by-field one,
 * against the read it wrote from.
 */
async function sameShape(
  dir: string,
  read: Extract<ChatDbRead, { kind: "read" }>,
): Promise<Difference[]> {
  const fold = new ChatFold();
  for (const name of (await fs.readdir(dir)).toSorted()) {
    if (parseRecordFileName(name)) {
      fold.add(name, await fs.readFile(path.join(dir, name)));
    }
  }
  const found: Difference[] = [];
  const folded = new Map(fold.chat().sessions.map((one) => [one.id, one]));
  for (const { messages, session } of read.sessions) {
    const mine = folded.get(session.id);
    if (!mine) {
      addDifference(found, session.id, "a session", undefined);
      continue;
    }
    addDifferences(
      found,
      `${session.id} messages`,
      messages.map(({ message }) => message.id),
      mine.messages.slice(0, messages.length).map(({ id }) => id),
    );
    const byId = new Map(mine.messages.map((message) => [message.id, message]));
    for (const { message, parts } of messages) {
      const held = new Set(parts.map(({ part }) => part.metadata.id));
      addDifferences(
        found,
        `${session.id}/${message.id} parts`,
        parts.map(({ part }) => part.metadata.id),
        byId
          .get(message.id)
          ?.parts.map(({ metadata }) => metadata.id)
          .filter((id) => held.has(id)),
      );
    }
  }
  return found.slice(0, MAX_DIFFERENCES);
}

/**
 * Folds the records in `work` and compares them with what `chat.db` held:
 * every session row, every message in order, each of its parts in order
 * with its blobs read back, and each session's standing facts.
 *
 * Every part is compared twice. A fold reads one through the same schema the
 * store does, so a payload neither can read comes back as `data-unknown` on
 * both sides however little the line holds; the line itself is compared with
 * the row as well, as plain JSON, which is what a build that has a schema
 * for that payload would read.
 */
async function verify(
  work: string,
  read: Extract<ChatDbRead, { kind: "read" }>,
): Promise<Difference[]> {
  const fold = new ChatFold();
  const lines = new Map<string, unknown>();
  for (const name of (await fs.readdir(work)).toSorted()) {
    if (parseRecordFileName(name)) {
      const bytes = await fs.readFile(path.join(work, name));
      fold.add(name, bytes);
      addPartLines(lines, bytes);
    }
  }
  const found: Difference[] = [];
  for (const problem of fold.problems()) {
    addDifference(
      found,
      problem.name,
      undefined,
      problem.refused ?? `${problem.skipped} lines skipped`,
    );
  }
  const folded = new Map(fold.chat().sessions.map((one) => [one.id, one]));
  const load = (name: string) => fs.readFile(blobPath(work, name));
  for (const { messages, session, sites } of read.sessions) {
    const mine = folded.get(session.id);
    folded.delete(session.id);
    if (!mine) {
      addDifference(found, session.id, "a session", undefined);
      continue;
    }
    const row = Session.Schema.safeParse(sessionRow(mine));
    addDifferences(
      found,
      session.id,
      asRecordsKeepIt(session),
      row.success ? row.data : z.prettifyError(row.error),
    );
    addDifferences(
      found,
      `${session.id} messages`,
      messages.map(({ message }) => message.id),
      mine.messages.map(({ id }) => id),
    );
    const byId = new Map(mine.messages.map((message) => [message.id, message]));
    for (const { message, parts } of messages) {
      const where = `${session.id}/${message.id}`;
      const their = byId.get(message.id);
      if (!their) {
        continue;
      }
      const { parts: theirParts, ...theirMessage } = their;
      addDifferences(found, where, message, theirMessage);
      addDifferences(
        found,
        `${where} parts`,
        parts.map(({ part }) => part.metadata.id),
        theirParts.map(({ metadata }) => metadata.id),
      );
      const partsById = new Map(
        theirParts.map((part) => [part.metadata.id, part]),
      );
      for (const { part, stored } of parts) {
        const theirPart = partsById.get(part.metadata.id);
        let readBack: unknown;
        try {
          readBack = theirPart && (await partFromRecord(theirPart, load));
        } catch (error) {
          readBack = `its blob did not read back: ${String(error)}`;
        }
        addDifferences(found, `${where}/${part.metadata.id}`, part, readBack);
        datesKept(found, `${where}/${part.metadata.id}`, part, readBack);
        addDifferences(
          found,
          `${where}/${part.metadata.id} line`,
          withoutOutput(stored),
          withoutOutput(lines.get(part.metadata.id)),
        );
      }
    }
    addDifferences(found, `${session.id} sites`, sites, mine.sites);
  }
  for (const extra of folded.keys()) {
    addDifference(found, extra, undefined, "a session chat.db does not hold");
  }
  return found;
}

/**
 * Files the part each of a file's part lines holds under its id, as plain
 * JSON: what the bytes hold, before any schema here reads them.
 */
function addPartLines(lines: Map<string, unknown>, bytes: Buffer): void {
  for (const line of bytes.toString("utf8").split("\n")) {
    const record = parseJson(line);
    if (!isRecord(record) || record.t !== "part" || !isRecord(record.part)) {
      continue;
    }
    const id = isRecord(record.part.metadata)
      ? record.part.metadata.id
      : undefined;
    if (typeof id === "string") {
      lines.set(id, record.part);
    }
  }
}

/**
 * A part as its line is compared with its row: every field but the output,
 * whose bytes the comparison of the parts reads back out of its blob.
 */
function withoutOutput(part: unknown): unknown {
  if (!isRecord(part)) {
    return part;
  }
  const { output: _output, ...rest } = part;
  return rest;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Moves what a converted folder holds into the chat's record folder: blobs
 * first, then logs and settings, never over a file that is there already, and
 * the folder last.
 */
async function moveIntoPlace(chatDir: string, done: string): Promise<void> {
  const blobsFrom = blobsDir(done);
  if (await exists(blobsFrom)) {
    const blobsTo = blobsDir(chatDir);
    await fs.mkdir(blobsTo, { recursive: true });
    for (const name of await fs.readdir(blobsFrom)) {
      if (!isBlobName(name)) {
        continue;
      }
      // The same name is the same bytes, so one already there stands.
      if (await exists(path.join(blobsTo, name))) {
        await fs.rm(path.join(blobsFrom, name));
      } else {
        await fs.rename(path.join(blobsFrom, name), path.join(blobsTo, name));
      }
    }
    await syncDirectory(blobsTo);
  }
  for (const name of await fs.readdir(done)) {
    if (!parseRecordFileName(name)) {
      continue;
    }
    const target = path.join(chatDir, name);
    if (await exists(target)) {
      throw new Error(`${target} is already there`);
    }
    await fs.rename(path.join(done, name), target);
  }
  await syncDirectory(chatDir);
  await fs.rm(done, { force: true, recursive: true });
}

async function sizesIn(
  done: string,
): Promise<Pick<Converted, "blobBytes" | "blobs" | "logBytes">> {
  let logBytes = 0;
  for (const name of await fs.readdir(done)) {
    if (parseRecordFileName(name)) {
      logBytes += (await fs.stat(path.join(done, name))).size;
    }
  }
  let blobBytes = 0;
  let blobs = 0;
  const folder = blobsDir(done);
  for (const name of (await exists(folder)) ? await fs.readdir(folder) : []) {
    if (isBlobName(name)) {
      blobs += 1;
      blobBytes += (await fs.stat(path.join(folder, name))).size;
    }
  }
  return { blobBytes, blobs, logBytes };
}

/** The folder `blobPath` puts a record folder's blobs in. */
function blobsDir(dir: string): string {
  return path.dirname(blobPath(dir, "-"));
}

/** A record's place in its file, for a refusal to name. */
function whereIs(record: Unsequenced<LogRecord | SettingRecord>): string {
  switch (record.t) {
    case "set":
      return `${record.session} ${record.field}`;
    case "message":
      return record.message.id;
    case "part":
      return `${record.part.metadata.messageId}/${record.part.metadata.id}`;
    default:
      return record.t;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.stat(file);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

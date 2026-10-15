import fs from "node:fs/promises";
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
import { logFileName, marksFileName, parseRecordFileName } from "../file-names";
import { ChatFold, type FoldedSession } from "../fold";
import { partFromRecord, partToRecord, type SaveBlob } from "../part-blobs";
import { type LogRecord, type MarkRecord, RECORD_FORMAT } from "../record";
import { RecordWriter, type Unsequenced } from "../record-writer";
import { syncDirectory } from "../sync-directory";
import {
  addDifference,
  addDifferences,
  type Difference,
  MAX_DIFFERENCES,
} from "./compare";
import {
  type ChatDbPart,
  type ChatDbRead,
  type ChatDbSession,
  readChatDb,
  TOLD_KEYS,
} from "./read-chat-db";

/**
 * Turning a chat's `chat.db` into records: a log per session, the person's
 * marks, and a blob for each file a tool returned, all from this device.
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
 * folder whose moves the next run finishes. A chat that holds records
 * already, from this device or another, is not converted again.
 *
 * Each record's `at` is when the session was last updated, which is all
 * `chat.db` says of when anything was written, and is the newest record's
 * `at` a fold reads as the session's `updatedAt`. A mark's `at` is the date
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
  /** The size of every log and the marks file together. */
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
    "no-store": 0,
    unreadable: 0,
  };
  for (const chat of chats) {
    counts[chat.kind] += 1;
  }
  return {
    chats,
    complete: counts.different + counts.failed + counts.unreadable === 0,
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
    if (await holdsRecords(chatDir)) {
      return { kind: "already-converted", store };
    }
    const chat = ChatIdSchema.safeParse(path.basename(chatDir));
    if (!chat.success) {
      return {
        error: `${path.basename(chatDir)} is not a chat id: ${z.prettifyError(chat.error)}`,
        kind: "failed",
      };
    }
    return await convert(chatDir, chat.data, store, options);
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

async function holdsRecords(chatDir: string): Promise<boolean> {
  return (await fs.readdir(chatDir)).some(
    (name) => parseRecordFileName(name) !== undefined,
  );
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
  const marks: Unsequenced<MarkRecord>[] = [];
  for (const entry of read.sessions) {
    const name = logFileName(entry.session.id, options.deviceId);
    written.refused.push(
      ...(await writeFile(
        path.join(work, name),
        "log",
        await logRecords(chat, entry, options, save),
      )),
    );
    marks.push(...marksOf(entry.session, options.deviceId));
    written.messages += entry.messages.length;
    written.parts += entry.messages.reduce(
      (total, { parts }) => total + parts.length,
      0,
    );
  }
  if (marks.length > 0) {
    written.refused.push(
      ...(await writeFile(
        path.join(work, marksFileName(options.deviceId)),
        "marks",
        marks,
      )),
    );
  }
  await syncDirectory(work);
  return written;
}

/** Writes a file's records in order, syncs it, and says which it refused. */
async function writeFile(
  file: string,
  kind: "log" | "marks",
  records: Unsequenced<LogRecord | MarkRecord>[],
): Promise<Difference[]> {
  const writer = new RecordWriter(file, kind, {
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
 * A session's log: its header, each message followed by its parts, then
 * where its context was last reset, who stopped it, and what it was told.
 */
async function logRecords(
  chat: ChatId,
  { messages, session, told }: ChatDbSession,
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
  if (session.stoppedBy !== undefined) {
    records.push({ t: "stopped", at, by: session.stoppedBy });
  }
  for (const [what] of TOLD_KEYS) {
    if (what in told) {
      records.push({ t: "told", at, what, value: told[what] });
    }
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
 * The person's marks on a session. A chat's own session always has a title
 * mark; a task's title is in its log's header, and is a mark only once it
 * settled.
 */
function marksOf(
  session: Session.Type,
  device: DeviceId,
): Unsequenced<MarkRecord>[] {
  const at = lastUpdate(session);
  const of = { t: "mark", session: session.id, device } as const;
  const marks: Unsequenced<MarkRecord>[] = [];
  if (session.parentId === undefined || session.titleSettledAt !== undefined) {
    marks.push({
      ...of,
      at: session.titleSettledAt ?? at,
      field: "title",
      value: {
        settled: session.titleSettledAt !== undefined,
        text: session.title,
      },
    });
  }
  if (session.starredAt !== undefined) {
    marks.push({ ...of, at: session.starredAt, field: "starred", value: true });
  }
  if (session.archivedAt !== undefined) {
    marks.push({
      ...of,
      at: session.archivedAt,
      field: "archived",
      value: true,
    });
  }
  if (session.unreadAt !== undefined) {
    marks.push({
      ...of,
      at: session.unreadAt,
      field: "unread",
      value: { byUser: session.unreadByUser === true },
    });
  }
  if (session.topics !== undefined) {
    marks.push({ ...of, at, field: "topics", value: session.topics });
  }
  if (session.stoppedAt !== undefined) {
    marks.push({
      ...of,
      at: session.stoppedAt,
      field: "stoppedAt",
      value: session.stoppedAt,
    });
  }
  return marks;
}

/** The session row a folded session stands for, as `chat.db` kept it. */
function sessionRow(folded: FoldedSession): unknown {
  const { marks, rollover } = folded;
  const title = marks.title;
  const unread = marks.unread;
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
    ...(title?.value.settled === true ? { titleSettledAt: title.at } : {}),
    ...(marks.starred?.value === true ? { starredAt: marks.starred.at } : {}),
    ...(marks.archived?.value === true
      ? { archivedAt: marks.archived.at }
      : {}),
    ...(unread?.value ? { unreadAt: unread.at } : {}),
    ...(unread?.value?.byUser === true ? { unreadByUser: true } : {}),
    ...(marks.topics ? { topics: marks.topics.value } : {}),
    ...(marks.stoppedAt ? { stoppedAt: marks.stoppedAt.value } : {}),
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
 * Folds the records in `work` and compares them with what `chat.db` held:
 * every session row, every message in order, each of its parts in order
 * with its blobs read back, and what each session was told.
 */
async function verify(
  work: string,
  read: Extract<ChatDbRead, { kind: "read" }>,
): Promise<Difference[]> {
  const fold = new ChatFold();
  for (const name of (await fs.readdir(work)).toSorted()) {
    if (parseRecordFileName(name)) {
      fold.add(name, await fs.readFile(path.join(work, name)));
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
  for (const { messages, session, told } of read.sessions) {
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
      { ...session, updatedAt: lastUpdate(session) },
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
      for (const { part } of parts) {
        const theirPart = partsById.get(part.metadata.id);
        let readBack: unknown;
        try {
          readBack = theirPart && (await partFromRecord(theirPart, load));
        } catch (error) {
          readBack = `its blob did not read back: ${String(error)}`;
        }
        addDifferences(found, `${where}/${part.metadata.id}`, part, readBack);
      }
    }
    addDifferences(found, `${session.id} told`, told, mine.told);
  }
  for (const extra of folded.keys()) {
    addDifference(found, extra, undefined, "a session chat.db does not hold");
  }
  return found;
}

/**
 * Moves what a converted folder holds into the chat's record folder: blobs
 * first, then logs and marks, never over a file that is there already, and
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
function whereIs(record: Unsequenced<LogRecord | MarkRecord>): string {
  switch (record.t) {
    case "mark":
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

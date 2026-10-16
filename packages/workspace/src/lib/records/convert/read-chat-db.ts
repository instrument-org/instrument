import { createDatabase } from "db0";
import sqlite from "db0/connectors/node-sqlite";
import { type ResultAsync } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";
import { alphabetical } from "radashi";
import superjson from "superjson";
import { createStorage } from "unstorage";
import dbDriver from "unstorage/drivers/db0";
import { type z } from "zod";

import { Session } from "../../../schemas/session";
import { SessionMessage } from "../../../schemas/session/message";
import { SessionMessagePart } from "../../../schemas/session/message-part";
import { SessionMessageRelaxedPart } from "../../../schemas/session/message-relaxed-part";
import { StoreId } from "../../../schemas/store-id";
import { TypedError } from "../../errors";
import { getParsedStorageItem } from "../../get-parsed-storage-item";
import { sweepInterruptedToolCalls } from "../../interrupted-tool-calls";
import { StorageKey } from "../../storage-key";
import { runStoreMigrations } from "../../store-migrations";
import { STORE_TABLE } from "../../store-table";
import { type WrappedStorage, wrapStorage } from "../../wrap-storage";
import { type StateWhat } from "../record";

/**
 * Reading a chat's `chat.db` as the store read it, for turning it into
 * records. The database itself is never opened: a copy of it is, beside the
 * converter's other temporary files, through the same driver the store used.
 * On the copy, the store's migrations run and the tool calls a process left
 * in flight are finished as interrupted, as opening a chat did; everything
 * else is read, never written.
 *
 * What comes back is what the store's reads gave, through the same schemas
 * and in the same order: every session, its messages by id, each message's
 * parts by id with the row each was read from, and what the session was
 * last state. Moved folders are not read back where a move took them, which
 * the store did for display; the records keep the paths as they were
 * written.
 */

interface ChatDbMessage {
  message: SessionMessage.Type;
  parts: ChatDbPart[];
}

/** A part as the store read it, beside the row it was read from. */
export interface ChatDbPart {
  /** The part the store's read gave, which a record of it reads back as. */
  part: SessionMessagePart.Type;
  /**
   * The row itself, which is what a log keeps. Reading a part fills in what
   * its payload's schema defaults, drops what that schema has no field for,
   * and gives back `data-unknown` in place of a payload no schema here reads
   * at all, so only the row holds what was written.
   */
  stored: SessionMessageRelaxedPart.Type;
}

export interface ChatDbSession {
  messages: ChatDbMessage[];
  session: Session.Type;
  /** What the session was last told of each, as its module wrote it. */
  state: Partial<Record<StateWhat, unknown>>;
}

export type ChatDbRead =
  | {
      kind: "read";
      /**
       * Rows no read took, by the first segment of their key: keys this build
       * no longer reads, and messages or parts of a session or message the
       * store has no record of.
       */
      leftBehind: Record<string, number>;
      /** By id. */
      sessions: ChatDbSession[];
      /** Tool calls finished as interrupted on the way in. */
      swept: number;
    }
  /** The store could not have read the chat either. */
  | { error: string; kind: "unreadable" };

/** The key of each thing a session is state, as the store kept it. */
export const TOLD_KEYS: readonly (readonly [
  StateWhat,
  (session: StoreId.Session) => string,
])[] = [
  ["apps", StorageKey.chatAppsBaseline],
  ["browser", StorageKey.browserState],
  ["folders", StorageKey.foldersBaseline],
  ["memory", StorageKey.memoryReported],
  ["processes", StorageKey.backgroundProcessesReported],
];

/** Rows the store keeps for itself, which are no part of the chat. */
const BOOKKEEPING = new Set(["__canary__", "__migration_version__"]);

/** What a database leaves beside itself mid-transaction, which a copy has to carry. */
const SIDECARS = ["-wal", "-journal"];

class Unreadable extends Error {}

/**
 * Reads the chat in `file`, through a copy made in `scratch` and left there
 * for the caller to remove.
 */
export async function readChatDb(
  file: string,
  scratch: string,
): Promise<ChatDbRead> {
  await fs.mkdir(scratch, { recursive: true });
  const copy = path.join(scratch, path.basename(file));
  await copyStore(file, copy);
  const database = createDatabase(sqlite({ path: copy }));
  const storage = wrapStorage(
    createStorage({ driver: dbDriver({ database, tableName: STORE_TABLE }) }),
  );
  try {
    return await readStorage(storage);
  } catch (error) {
    if (error instanceof Unreadable) {
      return { error: error.message, kind: "unreadable" };
    }
    throw error;
  } finally {
    // Unstorage's db0 driver never closes the database it was given.
    (await database.getInstance()).close();
    await storage.dispose();
  }
}

/**
 * Copies a database with whatever it left beside itself, so opening the copy
 * replays or rolls back what the original was in the middle of. A clone
 * where the file system makes one.
 */
async function copyStore(file: string, copy: string): Promise<void> {
  await fs.copyFile(file, copy, fs.constants.COPYFILE_FICLONE);
  for (const suffix of SIDECARS) {
    try {
      await fs.copyFile(
        `${file}${suffix}`,
        `${copy}${suffix}`,
        fs.constants.COPYFILE_FICLONE,
      );
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
    }
  }
}

async function readStorage(storage: WrappedStorage): Promise<ChatDbRead> {
  const migrated = await runStoreMigrations({ storage });
  if (migrated.isErr()) {
    throw new Unreadable(
      `The store's migrations failed: ${migrated.error.message}`,
    );
  }
  // As opening a chat did: a sweep that fails leaves the parts as they were.
  const swept = await sweepInterruptedToolCalls({ storage });
  const taken = new Set<string>();
  const sessions: ChatDbSession[] = [];
  for (const id of await idsUnder(storage, StorageKey.sessions(), (value) =>
    StoreId.SessionSchema.safeParse(value),
  )) {
    const key = StorageKey.session(id);
    const session = await need(
      getParsedStorageItem(key, Session.Schema, storage),
      key,
    );
    taken.add(key);
    sessions.push({
      messages: await readMessages(storage, id, taken),
      session,
      state: await readState(storage, id, taken),
    });
  }
  const leftBehind: Record<string, number> = {};
  for (const key of await need(storage.getKeys(), "the list of keys")) {
    if (!taken.has(key) && !BOOKKEEPING.has(key)) {
      const prefix = key.split(":")[0] ?? key;
      leftBehind[prefix] = (leftBehind[prefix] ?? 0) + 1;
    }
  }
  return {
    kind: "read",
    leftBehind,
    sessions: sessions.toSorted((a, b) =>
      a.session.id < b.session.id ? -1 : 1,
    ),
    swept: swept.isOk() ? swept.value.swept : 0,
  };
}

/**
 * A session's messages as the store read them: by id, a message whose row
 * holds nothing skipped, each with its parts filed under the session its
 * metadata names.
 */
async function readMessages(
  storage: WrappedStorage,
  sessionId: StoreId.Session,
  taken: Set<string>,
): Promise<ChatDbMessage[]> {
  const messages: ChatDbMessage[] = [];
  for (const id of await idsUnder(
    storage,
    StorageKey.messages(sessionId),
    (value) => StoreId.MessageSchema.safeParse(value),
  )) {
    const key = StorageKey.message(sessionId, id);
    const message = await getParsedStorageItem(
      key,
      SessionMessage.Schema,
      storage,
    );
    if (message.isErr() && message.error instanceof TypedError.NotFound) {
      continue;
    }
    if (message.isErr()) {
      throw new Unreadable(`${key}: ${message.error.message}`);
    }
    taken.add(key);
    messages.push({
      message: message.value,
      parts: await readParts(
        storage,
        message.value.metadata.sessionId,
        message.value.id,
        taken,
      ),
    });
  }
  return messages;
}

async function readParts(
  storage: WrappedStorage,
  sessionId: StoreId.Session,
  messageId: StoreId.Message,
  taken: Set<string>,
): Promise<ChatDbPart[]> {
  const parts: ChatDbPart[] = [];
  for (const id of await idsUnder(
    storage,
    StorageKey.parts(sessionId, messageId),
    (value) => StoreId.PartSchema.safeParse(value),
  )) {
    const key = StorageKey.part(sessionId, messageId, id);
    const stored = await need(
      getParsedStorageItem(key, SessionMessageRelaxedPart.Schema, storage),
      key,
    );
    taken.add(key);
    parts.push({ part: SessionMessagePart.coerce(stored), stored });
  }
  return parts;
}

/**
 * What a session was last told of each thing, decoded but not parsed: the
 * value its module wrote, which that module's own schema reads. A row that
 * does not decode, or holds nothing, is as good as none, as it was to the
 * module.
 */
async function readState(
  storage: WrappedStorage,
  sessionId: StoreId.Session,
  taken: Set<string>,
): Promise<ChatDbSession["state"]> {
  const state: ChatDbSession["state"] = {};
  for (const [what, keyOf] of TOLD_KEYS) {
    const key = keyOf(sessionId);
    const value = decode(await need(storage.getItemRaw(key), key));
    if (value !== undefined) {
      taken.add(key);
    }
    if (value !== undefined && value !== null) {
      state[what] = value;
    }
  }
  return state;
}

/** The ids under a key, sorted as the store sorted them. */
async function idsUnder<T extends string>(
  storage: WrappedStorage,
  base: string,
  parse: (value: unknown) => z.ZodSafeParseResult<T>,
): Promise<T[]> {
  const ids: T[] = [];
  for (const key of await need(storage.getKeys(base), base)) {
    const id = parse(key.split(":").at(-1));
    if (!id.success) {
      throw new Unreadable(`${key} does not end in an id`);
    }
    ids.push(id.data);
  }
  return alphabetical(ids, (id) => id);
}

async function need<T>(result: ResultAsync<T, Error>, what: string) {
  const settled = await result;
  if (settled.isErr()) {
    throw new Unreadable(`${what}: ${settled.error.message}`);
  }
  return settled.value;
}

function decode(raw: unknown): unknown {
  const text =
    typeof raw === "string"
      ? raw
      : Buffer.isBuffer(raw)
        ? raw.toString()
        : undefined;
  if (text === undefined) {
    return undefined;
  }
  try {
    return superjson.parse(text);
  } catch {
    return undefined;
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

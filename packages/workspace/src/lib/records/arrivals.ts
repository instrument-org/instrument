import { SETTINGS_FILE_NAME } from "@instrument-org/shared";
import fs from "node:fs";
import path from "node:path";

import { type StoreId } from "../../schemas/store-id";
import { type DeviceId } from "./device-id";
import { parseRecordFileName } from "./file-names";
import { readLog, readSettings } from "./read-records";

/**
 * Noticing what another device's files bring to the workspace's chats while
 * the app runs: its logs and settings files growing, a log or a chat it
 * started, a chat's `settings.json` it wrote. A sync engine puts them in the
 * record folders behind the app's back, and nothing else here reads a chat's
 * folder again once it is folded.
 *
 * Three things look, all of them only at the record folders, which hold
 * nothing but what the app and its other devices write:
 *
 * - One recursive watch on the chats folder where the system watches a
 *   tree with one handle (macOS, Windows). On Linux, where a recursive
 *   watch costs a handle per folder, the chats folder itself is watched for
 *   chats coming and going, and a chat's folder only while something shows
 *   it (`attend`).
 * - A look at every chat when the window comes forward, and every minute
 *   while it is in front (`setForeground`), so a change a watch missed is
 *   late rather than lost.
 * - Each look stats a chat's files against what the last one saw and reads
 *   only the bytes a file gained, for which messages they name.
 *
 * This device's own files are never looked at: its writes keep its fold
 * current and say what they changed. An arrival only says what moved; it
 * never starts a turn.
 */

/** What another device's files brought one chat, as one look found it. */
export interface Arrival {
  /** The chat's folder name, its id. */
  chat: string;
  /** Messages whose records arrived, and whether they were taken out. */
  messages: {
    id: StoreId.Message;
    removed: boolean;
    sessionId: StoreId.Session;
  }[];
  /** A folder this process had not seen before: a chat another device started. */
  new: boolean;
  /** Records other than a message's arrived: a header, a stop, a setting, a file gone. */
  session: boolean;
  /** Its `settings.json` changed. */
  settings: boolean;
}

interface RecordArrivalsOptions {
  /** The workspace's chats folder, a record folder per chat. */
  chatsDir: string;
  device: DeviceId;
  /** Told of each chat whose folder changed, one look at a time. */
  onArrival: (arrival: Arrival) => Promise<void> | void;
  /** Told of a look or a watch that failed. */
  onError?: (error: unknown) => void;
  platform?: NodeJS.Platform;
  /** How long a burst of watch events is gathered before a look. */
  settleMs?: number;
  /** How often every chat is looked at while the window is in front. */
  sweepMs?: number;
  /** Whether to watch at all; off in tests that drive `look` themselves. */
  watch?: boolean;
}

/** What the last look saw of one file. */
interface Seen {
  mtimeMs: number;
  /** How far its records were read, for another device's log or settings file. */
  offset: number;
  size: number;
}

const SETTLE_MS = 250;
const SWEEP_MS = 60_000;

export class RecordArrivals {
  readonly #attended = new Map<string, { count: number; stop: () => void }>();
  readonly #chatsDir: string;
  readonly #device: DeviceId;
  readonly #dirty = new Set<string>();
  #everything = false;
  /** Each chat's files as the last look saw them, by folder name. */
  readonly #files = new Map<string, Map<string, Seen>>();
  #looking: Promise<void> = Promise.resolve();
  readonly #onArrival: RecordArrivalsOptions["onArrival"];
  readonly #onError: (error: unknown) => void;
  readonly #platform: NodeJS.Platform;
  readonly #settleMs: number;
  #settleTimer: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;
  #sweepTimer: ReturnType<typeof setInterval> | undefined;
  readonly #sweepMs: number;
  readonly #watch: boolean;
  #stopWatch: (() => void) | undefined;

  constructor({
    chatsDir,
    device,
    onArrival,
    onError = () => undefined,
    platform = process.platform,
    settleMs = SETTLE_MS,
    sweepMs = SWEEP_MS,
    watch = true,
  }: RecordArrivalsOptions) {
    this.#chatsDir = chatsDir;
    this.#device = device;
    this.#onArrival = onArrival;
    this.#onError = onError;
    this.#platform = platform;
    this.#settleMs = settleMs;
    this.#sweepMs = sweepMs;
    this.#watch = watch;
  }

  /**
   * Takes what every chat's folder has now as seen, without reading it,
   * since the app folds a chat from its folder when it first reads it, and
   * starts watching.
   */
  async start(): Promise<void> {
    for (const chat of await this.#chatNames()) {
      const files = new Map<string, Seen>();
      for (const name of await namesIn(path.join(this.#chatsDir, chat))) {
        const stat = await this.#stat(chat, name);
        if (stat && this.#looksAt(name)) {
          files.set(name, { ...stat, offset: stat.size });
        }
      }
      this.#files.set(chat, files);
    }
    if (this.#watch && !this.#stopped) {
      this.#startWatch();
    }
  }

  /** Stops watching and looking. */
  stop(): void {
    this.#stopped = true;
    clearTimeout(this.#settleTimer);
    clearInterval(this.#sweepTimer);
    this.#stopWatch?.();
    for (const { stop } of this.#attended.values()) {
      stop();
    }
    this.#attended.clear();
  }

  /**
   * Looks at every chat now and every `sweepMs` while the window is in
   * front, and stops the timer when it goes behind.
   */
  setForeground(foreground: boolean): void {
    clearInterval(this.#sweepTimer);
    this.#sweepTimer = undefined;
    if (!foreground || this.#stopped) {
      return;
    }
    void this.look();
    this.#sweepTimer = setInterval(() => void this.look(), this.#sweepMs);
  }

  /**
   * Watches one chat's folder while something shows it, where the chats
   * folder is not watched as a tree; elsewhere the tree's watch covers it.
   */
  attend(chat: string): () => void {
    if (!this.#watch || this.#stopped || this.#recursive()) {
      return () => undefined;
    }
    const known = this.#attended.get(chat);
    if (known) {
      known.count += 1;
    } else {
      this.#attended.set(chat, {
        count: 1,
        stop: this.#watchFolder(path.join(this.#chatsDir, chat), false, () =>
          this.#mark(chat),
        ),
      });
    }
    let released = false;
    return () => {
      const entry = this.#attended.get(chat);
      if (released || !entry) {
        return;
      }
      released = true;
      entry.count -= 1;
      if (entry.count === 0) {
        entry.stop();
        this.#attended.delete(chat);
      }
    };
  }

  /**
   * Looks at the chats named, or at every chat, behind any look under way,
   * and tells of each one whose folder changed.
   */
  look(chats?: readonly string[]): Promise<void> {
    const next = this.#looking.then(async () => {
      if (this.#stopped) {
        return;
      }
      for (const chat of chats ?? (await this.#chatNames())) {
        try {
          const arrival = await this.#lookAt(chat);
          if (arrival) {
            await this.#onArrival(arrival);
          }
        } catch (error) {
          this.#onError(error);
        }
      }
    });
    this.#looking = next.catch(this.#onError);
    return this.#looking;
  }

  async #lookAt(chat: string): Promise<Arrival | undefined> {
    const dir = path.join(this.#chatsDir, chat);
    const names = await namesIn(dir);
    const known = this.#files.get(chat);
    if (names.length === 0 && !fs.existsSync(dir)) {
      // Gone: whatever took it (a trash, here or from another device) says so.
      this.#files.delete(chat);
      return undefined;
    }
    const arrival: Arrival = {
      chat,
      messages: [],
      new: known === undefined,
      session: false,
      settings: false,
    };
    const files = known ?? new Map<string, Seen>();
    this.#files.set(chat, files);
    let changed = arrival.new;
    for (const name of names) {
      if (!this.#looksAt(name)) {
        continue;
      }
      const stat = await this.#stat(chat, name);
      const seen = files.get(name);
      if (
        !stat ||
        (seen && seen.size === stat.size && seen.mtimeMs === stat.mtimeMs)
      ) {
        continue;
      }
      changed = true;
      if (name === SETTINGS_FILE_NAME) {
        arrival.settings = true;
        files.set(name, { ...stat, offset: 0 });
        continue;
      }
      if (arrival.new) {
        // Folded whole when first read, so there is nothing to name.
        files.set(name, { ...stat, offset: stat.size });
        continue;
      }
      const from = seen && stat.size >= seen.offset ? seen.offset : 0;
      files.set(name, {
        ...stat,
        offset: await this.#read(dir, name, from, arrival),
      });
    }
    for (const name of files.keys()) {
      if (!names.includes(name)) {
        files.delete(name);
        arrival.session = true;
        changed = true;
      }
    }
    return changed ? arrival : undefined;
  }

  /** Reads a file from `from` for the messages it names, answering how far it read. */
  async #read(
    dir: string,
    name: string,
    from: number,
    arrival: Arrival,
  ): Promise<number> {
    const parsed = parseRecordFileName(name);
    let bytes: Buffer;
    try {
      const handle = await fs.promises.open(path.join(dir, name), "r");
      try {
        const { size } = await handle.stat();
        bytes = Buffer.alloc(Math.max(0, size - from));
        await handle.read(bytes, 0, bytes.length, from);
      } finally {
        await handle.close();
      }
    } catch {
      return from;
    }
    const cursor = { lastSeq: -1, offset: from };
    if (parsed?.kind !== "log") {
      const read = readSettings(bytes, cursor);
      if (read.records.length > 0) {
        arrival.session = true;
      }
      return read.cursor.offset;
    }
    const read = readLog(bytes, cursor);
    if (read.kind === "refused") {
      return from + bytes.length;
    }
    for (const { record } of read.records) {
      switch (record.t) {
        case "message":
          arrival.messages.push({
            id: record.message.id,
            removed: false,
            sessionId: parsed.session,
          });
          break;
        case "part":
          arrival.messages.push({
            id: record.part.metadata.messageId,
            removed: false,
            sessionId: parsed.session,
          });
          break;
        case "retract":
          for (const id of record.messages) {
            arrival.messages.push({
              id,
              removed: true,
              sessionId: parsed.session,
            });
          }
          break;
        default:
          arrival.session = true;
      }
    }
    return read.cursor.offset;
  }

  /** Whether a look reads this file: another device's log or settings file, or `settings.json`. */
  #looksAt(name: string): boolean {
    if (name === SETTINGS_FILE_NAME) {
      return true;
    }
    const parsed = parseRecordFileName(name);
    return parsed !== undefined && parsed.device !== this.#device;
  }

  async #stat(
    chat: string,
    name: string,
  ): Promise<{ mtimeMs: number; size: number } | undefined> {
    try {
      const { mtimeMs, size } = await fs.promises.stat(
        path.join(this.#chatsDir, chat, name),
      );
      return { mtimeMs, size };
    } catch {
      return undefined;
    }
  }

  async #chatNames(): Promise<string[]> {
    try {
      const entries = await fs.promises.readdir(this.#chatsDir, {
        withFileTypes: true,
      });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  #recursive(): boolean {
    return this.#platform === "darwin" || this.#platform === "win32";
  }

  #startWatch(): void {
    try {
      fs.mkdirSync(this.#chatsDir, { recursive: true });
    } catch (error) {
      this.#onError(error);
      return;
    }
    const recursive = this.#recursive();
    this.#stopWatch = this.#watchFolder(
      this.#chatsDir,
      recursive,
      (filename) => {
        if (filename === null) {
          this.#markEverything();
          return;
        }
        const [chat, name, ...deeper] = filename.split(/[\\/]/);
        if (chat === undefined || chat === "" || deeper.length > 0) {
          return;
        }
        if (name === undefined || this.#looksAt(name)) {
          this.#mark(chat);
        }
      },
    );
  }

  /** Watches a folder, answering how to stop. A watch that fails is said and closed. */
  #watchFolder(
    dir: string,
    recursive: boolean,
    onEvent: (filename: null | string) => void,
  ): () => void {
    let watcher: fs.FSWatcher;
    try {
      watcher = fs.watch(dir, { recursive }, (_event, filename) => {
        onEvent(filename);
      });
    } catch (error) {
      this.#onError(error);
      return () => undefined;
    }
    watcher.on("error", (error) => {
      this.#onError(error);
      watcher.close();
    });
    return () => {
      watcher.close();
    };
  }

  #mark(chat: string): void {
    this.#dirty.add(chat);
    this.#settle();
  }

  #markEverything(): void {
    this.#everything = true;
    this.#settle();
  }

  #settle(): void {
    clearTimeout(this.#settleTimer);
    this.#settleTimer = setTimeout(() => {
      const everything = this.#everything;
      const chats = [...this.#dirty];
      this.#everything = false;
      this.#dirty.clear();
      void this.look(everything ? undefined : chats);
    }, this.#settleMs);
  }
}

async function namesIn(dir: string): Promise<string[]> {
  try {
    return await fs.promises.readdir(dir);
  } catch {
    return [];
  }
}

import { createHash } from "node:crypto";
import fs, { type FileHandle } from "node:fs/promises";

import {
  type LogRecord,
  type SettingRecord,
  parseLogLine,
  parseSettingLine,
  recordLine,
} from "./record";

/** A record before the writer gives it its `seq`. */
export type Unsequenced<R> = R extends unknown ? Omit<R, "seq"> : never;

/**
 * What the index keeps of a log to tell, before the next append, whether
 * the file is still the one it saw: its size, a hash of its last bytes, and
 * the last `seq` in it.
 */
export interface LogCursor {
  lastSeq: number;
  size: number;
  tailHash: string;
}

/** How many of a file's last bytes its tail hash covers. */
export const TAIL_BYTES = 4096;

const NEWLINE = 0x0a;

/** The tail hash of a file whose bytes these are. */
export function tailHash(bytes: Uint8Array): string {
  return createHash("sha256")
    .update(bytes.subarray(Math.max(0, bytes.length - TAIL_BYTES)))
    .digest("hex");
}

/**
 * Told of each write a writer makes to its file once the bytes are in it:
 * the bytes, and where in the file they start. A line is one write, and so
 * is the newline a burst adds after a line a crash cut short.
 */
export type OnWrite = (bytes: Uint8Array, offset: number) => void;

/**
 * What a writer's file holds: how a record becomes its line, and which
 * records the file refuses.
 */
export interface RecordFormat<R> {
  /** The record as its line, newline included, once it has its `seq`. */
  line(record: Unsequenced<R>, seq: number): string;
  /**
   * Why a record cannot follow a file whose last `seq` is `lastSeq`, checked
   * as its line is about to be written, or nothing when it can.
   */
  misplaced?(record: Unsequenced<R>, lastSeq: number): string | undefined;
  /** Why a record would not read back from the file, or nothing when it would. */
  refusal(record: Unsequenced<R>): string | undefined;
}

/** A chat's log (`<session>.<device>.jsonl`) or settings file (`settings.<device>.jsonl`). */
export function chatRecordFormat(
  kind: "log" | "settings",
  path: string,
): RecordFormat<LogRecord | SettingRecord> {
  return {
    line: (record, seq) => recordLine({ ...record, seq }),
    // A log's header is its first line, and only that.
    misplaced: (record, lastSeq) => {
      if (
        kind === "settings" ||
        (record.t === "session") === (lastSeq === -1)
      ) {
        return undefined;
      }
      return record.t === "session"
        ? `${path} already has its header`
        : `${path} has no header to come after`;
    },
    refusal: (record) => {
      if ((record.t === "set") !== (kind === "settings")) {
        return `A ${record.t} record does not belong in a ${kind} file`;
      }
      // The seq is a placeholder: any count reads, and the real one is given
      // when the line is written.
      const line = recordLine({ ...record, seq: 0 });
      const parsed =
        kind === "log" ? parseLogLine(line) : parseSettingLine(line);
      return parsed === undefined
        ? `This ${record.t} record would not read back from ${path}`
        : undefined;
    },
  };
}

type Op<R> =
  | {
      kind: "commit";
      reject: (error: unknown) => void;
      resolve: () => void;
    }
  | {
      kind: "line";
      record: Unsequenced<R>;
      reject: (error: unknown) => void;
      resolve: (seq: number) => void;
    };

/**
 * Appends records to one file of them: a chat's log or settings file, or a
 * device's log of a synced store. One writer per file in the process, which
 * is the file's only writer anywhere:
 *
 * - Each record is one `write()` of its whole line, newline included, to a
 *   handle opened `O_APPEND`, and appends queue behind each other, so lines
 *   never interleave and no line is ever read back to be changed.
 * - The handle is opened for a burst of appends and closed once the queue
 *   is empty, since OneDrive will not sync a file an app holds open.
 * - Before a burst's first line, a file that does not end in `\n` gets one,
 *   so a line a crash cut short stays a line of its own that readers skip.
 * - `seq` carries on from the last record the file holds.
 * - `commit()` syncs the file to disk once the lines queued before it are
 *   written. Commits that queue together share one sync.
 */
export class RecordWriter<R = LogRecord | SettingRecord> {
  readonly path: string;
  /** Lines written since the file was last synced. */
  #dirty = false;
  #draining = false;
  readonly #format: RecordFormat<R>;
  #lastSeq: number;
  readonly #onWrite: OnWrite | undefined;
  #pending: Op<R>[] = [];
  #size: number;
  /** The file's last bytes, to hash for its cursor without reading it back. */
  #tail: Uint8Array;

  /**
   * @param file What the caller read of the file: its bytes so far and the
   *   last `seq` in them.
   */
  constructor(
    path: string,
    format: RecordFormat<R>,
    file: { bytes: Uint8Array; lastSeq: number },
    { onWrite }: { onWrite?: OnWrite } = {},
  ) {
    this.path = path;
    this.#format = format;
    this.#lastSeq = file.lastSeq;
    this.#onWrite = onWrite;
    this.#size = file.bytes.length;
    this.#tail = Buffer.from(file.bytes.subarray(-TAIL_BYTES));
  }

  /**
   * Appends a record and answers with its `seq` once its line is written,
   * which is not yet on disk: `commit()` is. A record that would not read
   * back is refused without writing anything.
   */
  append(record: Unsequenced<R>): Promise<number> {
    const refusal = this.#format.refusal(record);
    if (refusal) {
      return Promise.reject(new Error(refusal));
    }
    return new Promise((resolve, reject) => {
      this.#pending.push({ kind: "line", record, reject, resolve });
      this.#drain();
    });
  }

  /** Resolves once every line appended before it is on disk. */
  commit(): Promise<void> {
    if (!this.#dirty && this.#pending.length === 0 && !this.#draining) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      this.#pending.push({ kind: "commit", reject, resolve });
      this.#drain();
    });
  }

  /** The file as this writer last left it. */
  cursor(): LogCursor {
    return {
      lastSeq: this.#lastSeq,
      size: this.#size,
      tailHash: tailHash(this.#tail),
    };
  }

  #drain(): void {
    if (this.#draining) {
      return;
    }
    this.#draining = true;
    void this.#burst().finally(() => {
      this.#draining = false;
      if (this.#pending.length > 0) {
        this.#drain();
      }
    });
  }

  /**
   * Opens the file, writes what is queued until nothing is, and closes it.
   * A write that fails refuses everything not yet written, since the file's
   * end is unknown until the next burst checks it.
   */
  async #burst(): Promise<void> {
    let handle: FileHandle | undefined;
    let batch: Op<R>[] = [];
    try {
      handle = await fs.open(this.path, "a+");
      await this.#checkEnd(handle);
      while (this.#pending.length > 0) {
        batch = this.#pending.splice(0);
        await this.#write(handle, batch);
      }
    } catch (error) {
      // Ops the batch already settled ignore this.
      for (const op of [...batch, ...this.#pending.splice(0)]) {
        op.reject(error);
      }
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  /** Writes a batch's lines in order, then syncs once for every commit in it. */
  async #write(handle: FileHandle, batch: Op<R>[]): Promise<void> {
    let commits = false;
    for (const op of batch) {
      if (op.kind === "commit") {
        commits = true;
        continue;
      }
      const misplaced = this.#format.misplaced?.(op.record, this.#lastSeq);
      if (misplaced) {
        op.reject(new Error(misplaced));
        continue;
      }
      op.resolve(await this.#writeLine(handle, op.record));
    }
    if (commits && this.#dirty) {
      await handle.sync();
      this.#dirty = false;
    }
    for (const op of batch) {
      if (op.kind === "commit") {
        op.resolve();
      }
    }
  }

  async #writeLine(
    handle: FileHandle,
    record: Unsequenced<R>,
  ): Promise<number> {
    const seq = this.#lastSeq + 1;
    const line = Buffer.from(this.#format.line(record, seq));
    // Taken before the write: a line cut short still holds this seq, and the
    // next one must not reuse it.
    this.#lastSeq = seq;
    this.#dirty = true;
    await this.#append(handle, line);
    return seq;
  }

  /** Gives a file whose last line was cut short the newline it is missing. */
  async #checkEnd(handle: FileHandle): Promise<void> {
    const { size } = await handle.stat();
    const tail = Buffer.alloc(Math.min(size, TAIL_BYTES));
    if (tail.length > 0) {
      await handle.read(tail, 0, tail.length, size - tail.length);
    }
    this.#size = size;
    this.#tail = tail;
    if (size > 0 && tail.at(-1) !== NEWLINE) {
      await this.#append(handle, Buffer.from("\n"));
      this.#dirty = true;
    }
  }

  async #append(handle: FileHandle, bytes: Buffer): Promise<void> {
    const offset = this.#size;
    const { bytesWritten } = await handle.write(bytes);
    if (bytesWritten !== bytes.length) {
      throw new Error(
        `Wrote ${bytesWritten} of ${bytes.length} bytes to ${this.path}`,
      );
    }
    this.#size += bytes.length;
    // Concatenated into a new buffer, so a long line is not kept alive for
    // its last bytes.
    this.#tail = Buffer.concat([
      this.#tail,
      bytes.subarray(-TAIL_BYTES),
    ]).subarray(-TAIL_BYTES);
    this.#onWrite?.(bytes, offset);
  }
}

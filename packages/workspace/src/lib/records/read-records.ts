import {
  type LogRecord,
  type SettingRecord,
  parseLogLine,
  parseSettingLine,
} from "./record";

/**
 * Reading a log or a settings file, from its start or from where the last read
 * stopped. A record is taken only from a line that ends in `\n`, parses, and
 * carries a larger `seq` than the record before it; every other whole line
 * is counted and skipped. Bytes after the last `\n` are left for the next
 * read, since they may be a line still arriving.
 */

/** Where a read stopped: the byte after its last whole line, and the last `seq` it took. */
export interface ReadCursor {
  lastSeq: number;
  offset: number;
}

export const FILE_START: ReadCursor = { lastSeq: -1, offset: 0 };

interface ReadRecord<R> {
  /** The line that held it, which tells a copy of a record from another record. */
  line: string;
  /** Where its line starts in the file. */
  offset: number;
  record: R;
}

export interface RecordsRead<R> {
  cursor: ReadCursor;
  records: ReadRecord<R>[];
  /** Whole lines that were not records, or not newer than the one before. */
  skipped: number;
}

export type LogRead =
  | ({ kind: "read" } & RecordsRead<LogRecord>)
  /** The file's first line is not a session header, so it is not a log to read. */
  | { kind: "refused"; reason: "no-session-header" };

/**
 * Reads a log from `cursor` on; `bytes` is the file from that offset. A
 * file's first whole line has to be its session header, and a header later
 * in it is skipped like any other line that does not belong.
 */
export function readLog(bytes: Uint8Array, cursor = FILE_START): LogRead {
  const read = readLines(bytes, cursor, (text, offset) => {
    const record = parseLogLine(text);
    return (offset === 0) === (record?.t === "session") ? record : undefined;
  });
  const headerless =
    cursor.offset === 0 &&
    read.cursor.offset > 0 &&
    read.records[0]?.offset !== 0;
  return headerless
    ? { kind: "refused", reason: "no-session-header" }
    : { kind: "read", ...read };
}

/**
 * Reads a settings file from `cursor` on; `bytes` is the file from that
 * offset. A line of a field this format no longer has is read and left out,
 * rather than counted as a line that could not be read.
 */
export function readSettings(
  bytes: Uint8Array,
  cursor = FILE_START,
): RecordsRead<SettingRecord> {
  const read = readLines(
    bytes,
    cursor,
    (text) => parseSettingLine(text) ?? retiredSetting(text),
  );
  return {
    ...read,
    records: read.records.filter(
      (line): line is ReadRecord<SettingRecord> => !("retired" in line.record),
    ),
  };
}

/**
 * A `stoppedAt` line, which builds before kept a Stop on the chat's own turn
 * as: that Stop is a `stop` record in the session's log now. Such a line
 * says nothing a fold uses, since a stop holds only until the next turn,
 * and counting it as unreadable would make a file of them look damaged.
 */
function retiredSetting(
  text: string,
): { retired: true; seq: number } | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("t" in value) ||
    (value.t !== "set" && value.t !== "mark") ||
    !("field" in value) ||
    value.field !== "stoppedAt" ||
    !("seq" in value) ||
    typeof value.seq !== "number" ||
    !Number.isInteger(value.seq) ||
    value.seq < 0
  ) {
    return undefined;
  }
  return { retired: true, seq: value.seq };
}

const decoder = new TextDecoder("utf-8", { fatal: true });

export function readLines<R extends { seq: number }>(
  bytes: Uint8Array,
  cursor: ReadCursor,
  parse: (text: string, offset: number) => R | undefined,
): RecordsRead<R> {
  const records: ReadRecord<R>[] = [];
  let { lastSeq } = cursor;
  let skipped = 0;
  let end = 0;
  for (;;) {
    const newline = bytes.indexOf(0x0a, end);
    if (newline === -1) {
      break;
    }
    const offset = cursor.offset + end;
    const text = decode(bytes.subarray(end, newline));
    const record = text === undefined ? undefined : parse(text, offset);
    end = newline + 1;
    if (text === undefined || record === undefined || record.seq <= lastSeq) {
      skipped += 1;
      continue;
    }
    records.push({ line: text, offset, record });
    lastSeq = record.seq;
  }
  return {
    cursor: { lastSeq, offset: cursor.offset + end },
    records,
    skipped,
  };
}

function decode(bytes: Uint8Array): string | undefined {
  try {
    return decoder.decode(bytes);
  } catch {
    return undefined;
  }
}

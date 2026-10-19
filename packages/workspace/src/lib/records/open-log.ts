import fs from "node:fs/promises";
import path from "node:path";

import { type DeviceId } from "./device-id";
import {
  formerSettingsFileName,
  logFileName,
  parseRecordFileName,
  settingsFileName,
} from "./file-names";
import { readLog, readSettings } from "./read-records";
import {
  type LogRecord,
  type SettingRecord,
  RECORD_FORMAT,
  type SessionHeader,
} from "./record";
import {
  type LogCursor,
  type OnWrite,
  RecordWriter,
  tailHash,
  type Unsequenced,
} from "./record-writer";
import { syncDirectory } from "./sync-directory";

export interface LogWriter {
  readonly path: string;
  append(
    record: Unsequenced<Exclude<LogRecord, SessionHeader>>,
  ): Promise<number>;
  commit(): Promise<void>;
  cursor(): LogCursor;
}

export interface SettingsWriter {
  readonly path: string;
  append(record: Unsequenced<SettingRecord>): Promise<number>;
  commit(): Promise<void>;
}

type Header = Omit<SessionHeader, "at" | "format" | "seq" | "t">;

export interface OpenLogOptions {
  /** The chat's record folder. */
  dir: string;
  /**
   * What this device's log of the session says first, with everything the
   * device has read of the session's logs as `continues` (`continuesFor` on
   * its fold). Written only when a log is started.
   */
  header: Header;
  /** What the index last saw of this device's newest log of the session. */
  last?: { cursor: LogCursor; name: string };
  /** Told of each write to the log, its header included when it starts one. */
  onWrite?: OnWrite;
}

/**
 * Opens this device's log of a session to append to. The device carries on
 * in its newest log of the session while it recognizes it, and starts the
 * next one (`.2`, then `.3`) when:
 *
 * - The index saw the file differently: shorter than it was, or ending in
 *   other bytes. The device never writes on top of a file it does not
 *   recognize, and the new log carries on from what the index saw.
 * - The file's first line is not this session's header from this device.
 * - The device has read more of other devices' logs of the session than the
 *   file's header says. A header is the one place a log says what it
 *   carries on from, so carrying on after another device wrote takes a new
 *   log that says so; without it the fold reads the two devices' turns as
 *   written side by side, and flags the session as forked.
 *
 * Call it again once the fold has read another device's newer records of
 * the session, since the writer may then be for a new file.
 */
export async function openLog({
  dir,
  header,
  last,
  onWrite,
}: OpenLogOptions): Promise<LogWriter> {
  await fs.mkdir(dir, { recursive: true });
  const { highest, newest } = await ownLogs(dir, header);
  const lastLog = last && ownLog(last.name, header);
  const start = (seen: Record<string, number>) =>
    startLog(
      dir,
      logFileName(
        header.id,
        header.device,
        Math.max(highest, lastLog?.generation ?? 0) + 1,
      ),
      { ...header, continues: withSeen(header.continues, seen) },
      onWrite,
    );
  if (last && lastLog && lastLog.generation > (newest?.generation ?? 0)) {
    // The log the index last saw is gone.
    return start({ [lastLog.stem]: last.cursor.lastSeq });
  }
  if (newest === undefined) {
    return start({});
  }
  // A cursor for an older log than the newest says nothing about the newest,
  // which the index has not seen yet; its header is checked all the same.
  const cursor = last?.name === newest.name ? last.cursor : undefined;
  const current = await readOwnLog(dir, newest, header, cursor);
  if (current.kind === "unrecognized") {
    return start(cursor ? { [newest.stem]: cursor.lastSeq } : {});
  }
  if (readMoreThan(header, current.header)) {
    return start({
      ...current.header.continues,
      [newest.stem]: current.lastSeq,
    });
  }
  return new RecordWriter(path.join(dir, newest.name), "log", current, {
    onWrite,
  });
}

/**
 * Opens this device's settings file to append to. The file builds before
 * kept under `marks.<device>.jsonl` takes the settings name first: this
 * device is its only writer, and its lines are read the same under either
 * name, so a fold that already took them takes them once.
 */
export async function openSettingsFile(
  dir: string,
  device: DeviceId,
  { onWrite }: { onWrite?: OnWrite } = {},
): Promise<SettingsWriter> {
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, settingsFileName(device));
  await takeFormerName(path.join(dir, formerSettingsFileName(device)), file);
  const bytes = await readIfThere(file);
  return new RecordWriter(
    file,
    "settings",
    { bytes, lastSeq: readSettings(bytes).cursor.lastSeq },
    { onWrite },
  );
}

/** Renames a file to `to` when `to` is not there yet and the file is. */
async function takeFormerName(from: string, to: string): Promise<void> {
  if ((await readIfThere(to)).length > 0) {
    return;
  }
  try {
    await fs.rename(from, to);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  await syncDirectory(path.dirname(to));
}

type OwnLogName = { generation: number; name: string; stem: string };

/** A log name, when it is one of this device's logs of the session. */
function ownLog(name: string, header: Header): OwnLogName | undefined {
  const parsed = parseRecordFileName(name);
  return parsed?.kind === "log" &&
    parsed.session === header.id &&
    parsed.device === header.device
    ? { generation: parsed.generation, name, stem: parsed.stem }
    : undefined;
}

/**
 * The device's newest log of the session, and the highest log number in the
 * folder. Conflict copies count toward the number, so a log is never started
 * under a name a copy came from.
 */
async function ownLogs(
  dir: string,
  header: Header,
): Promise<{ highest: number; newest?: OwnLogName }> {
  let newest: OwnLogName | undefined;
  let highest = 0;
  for (const name of await fs.readdir(dir)) {
    const log = ownLog(name, header);
    if (!log) {
      continue;
    }
    highest = Math.max(highest, log.generation);
    const original = parseRecordFileName(name)?.copy === undefined;
    if (original && log.generation > (newest?.generation ?? 0)) {
      newest = log;
    }
  }
  return { highest, ...(newest && { newest }) };
}

type OwnLog =
  | { bytes: Uint8Array; header: SessionHeader; kind: "log"; lastSeq: number }
  | { kind: "unrecognized" };

async function readOwnLog(
  dir: string,
  log: OwnLogName,
  header: Header,
  cursor: LogCursor | undefined,
): Promise<OwnLog> {
  const bytes = await readIfThere(path.join(dir, log.name));
  if (
    cursor &&
    (bytes.length < cursor.size ||
      tailHash(bytes.subarray(0, cursor.size)) !== cursor.tailHash)
  ) {
    return { kind: "unrecognized" };
  }
  const read = readLog(bytes);
  const first = read.kind === "read" ? read.records[0]?.record : undefined;
  if (
    read.kind !== "read" ||
    first?.t !== "session" ||
    first.id !== header.id ||
    first.device !== header.device
  ) {
    return { kind: "unrecognized" };
  }
  return { bytes, header: first, kind: "log", lastSeq: read.cursor.lastSeq };
}

/** Whether the device has read more of other devices' logs than its log's header says. */
function readMoreThan(wanted: Header, current: SessionHeader): boolean {
  return Object.entries(wanted.continues ?? {}).some(
    ([stem, seq]) =>
      !stem.startsWith(wanted.device) &&
      seq > (current.continues?.[stem] ?? -1),
  );
}

function withSeen(
  continues: Record<string, number> | undefined,
  seen: Record<string, number>,
): Record<string, number> | undefined {
  const merged = { ...continues };
  for (const [stem, seq] of Object.entries(seen)) {
    merged[stem] = Math.max(merged[stem] ?? -1, seq);
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

async function startLog(
  dir: string,
  name: string,
  { continues, ...header }: Header,
  onWrite: OnWrite | undefined,
): Promise<LogWriter> {
  const file = path.join(dir, name);
  // Exclusive, so a log is only ever started, never written over.
  await (await fs.open(file, "wx")).close();
  await syncDirectory(dir);
  const writer = new RecordWriter(
    file,
    "log",
    { bytes: new Uint8Array(), lastSeq: -1 },
    { onWrite },
  );
  await writer.append({
    t: "session",
    at: new Date(),
    format: RECORD_FORMAT,
    ...header,
    ...(continues && { continues }),
  });
  return writer;
}

async function readIfThere(file: string): Promise<Uint8Array> {
  try {
    return await fs.readFile(file);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return new Uint8Array();
    }
    throw error;
  }
}

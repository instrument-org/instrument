import { createHash } from "node:crypto";
import { z } from "zod";

import { type DeviceId, DeviceIdSchema } from "../records/device-id";
import { COPY_SUFFIXES } from "../records/file-names";
import { type Place } from "../records/fold";
import { readLines } from "../records/read-records";
import { type RecordFormat, type Unsequenced } from "../records/record-writer";

/**
 * The lines of a synced store: one file per device per store,
 * `.instrument/devices/<device>/<domain>.jsonl`, appended to by that device
 * alone and read by every device. A line sets a key to a value or deletes it:
 *
 *     {"t":"set","seq":0,"at":"2026-10-19T12:00:00.000Z","key":"bookmark/01K…","value":{…},"device":"dev_7Q2M4K9X"}
 *     {"t":"del","seq":1,"at":"2026-10-19T12:05:00.000Z","key":"bookmark/01K…","device":"dev_7Q2M4K9X"}
 *
 * `seq` counts up from 0 within a file. A collection is a key per member, so
 * two devices changing different members never touch the same key, and a
 * delete is a line of its own that outranks the sets before it.
 */

/** What a domain is called: its file's name before `.jsonl`. */
const DOMAIN = /^[a-z][a-z0-9]*$/;

const DateSchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value));

const envelope = {
  at: DateSchema,
  /** The device whose file holds the line. */
  device: DeviceIdSchema,
  key: z.string().min(1),
  seq: z.number().int().nonnegative(),
};

const SyncedRecordSchema = z
  .discriminatedUnion("t", [
    z.object({ t: z.literal("set"), ...envelope, value: z.unknown() }),
    z.object({ t: z.literal("del"), ...envelope }),
  ])
  .refine((record) => record.t === "del" || record.value !== undefined, {
    message: "A set names its value",
  });

export type SyncedRecord = z.output<typeof SyncedRecordSchema>;

/** One change a store is asked for: a key set to a value, or deleted. */
export type SyncedOp =
  | { key: string; t: "del" }
  | { key: string; t: "set"; value: unknown };

/** A record as its file's line, newline included. */
export function syncedLine(record: SyncedRecord): string {
  const { at, seq, t, ...rest } = record;
  return `${JSON.stringify({ t, seq, at, ...rest })}\n`;
}

/** The record a line holds, or nothing for a line that is not one. */
export function parseSyncedLine(text: string): SyncedRecord | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  const parsed = SyncedRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** How a device's file of a store is written: every line has to read back. */
export const SYNCED_FORMAT: RecordFormat<SyncedRecord> = {
  line: (record, seq) => syncedLine({ ...record, seq }),
  refusal: (record) =>
    parseSyncedLine(syncedLine({ ...record, seq: 0 })) === undefined
      ? `A ${record.t} of ${record.key} would not read back`
      : undefined,
};

/** The whole lines of a file's bytes, as records, with the line each came from. */
export function readSyncedLines(
  bytes: Uint8Array,
): { line: string; record: SyncedRecord }[] {
  return readLines(bytes, { lastSeq: -1, offset: 0 }, parseSyncedLine).records;
}

/** Throws for a domain whose file name could be read as another's conflict copy. */
export function checkDomain(domain: string): void {
  if (!DOMAIN.test(domain)) {
    throw new Error(
      `A synced store's domain is lowercase letters and digits: ${domain}`,
    );
  }
}

/** The name of a device's file of a domain, in that device's folder. */
export function syncedFileName(domain: string): string {
  return `${domain}.jsonl`;
}

/**
 * Whether a name in a device's folder is that device's file of the domain,
 * or a copy a sync engine kept of it beside the original (` 2`,
 * ` (… conflicted copy …)`, `-<computer>`, `.sync-conflict-…`). A copy holds
 * the same lines as its original, or fewer, and folds as another copy of it.
 */
export function isSyncedFileName(name: string, domain: string): boolean {
  return new RegExp(`^${domain}${COPY_SUFFIXES}\\.jsonl$`).test(name);
}

/**
 * Where a record sorts among the records of its key; later is newer. The
 * newest `at` wins, ties go to the larger device id and then the larger
 * `seq`, and the line itself settles two lines that agree on all three,
 * which only a device that lost its file and reused its seqs writes.
 */
export function syncedPlace(record: SyncedRecord, line: string): Place {
  return [
    record.at.getTime(),
    record.device,
    record.seq,
    createHash("sha256").update(line).digest("base64url"),
  ];
}

/**
 * The records that make the ops so, for `device` to append: an op that
 * would change nothing (a key set to the value it has, a key deleted that is
 * not there) writes nothing. Each is stamped no earlier than one past the
 * record it replaces, so a change made here outranks what this device has
 * read even when another device's clock runs ahead of this one's.
 */
export function recordsFor(
  ops: readonly SyncedOp[],
  newest: (key: string) => SyncedRecord | undefined,
  device: DeviceId,
  now: number,
  isSame: (a: unknown, b: unknown) => boolean,
): Unsequenced<SyncedRecord>[] {
  // What the ops before this one in the batch made of each key.
  const made = new Map<string, Unsequenced<SyncedRecord>>();
  const records: Unsequenced<SyncedRecord>[] = [];
  for (const op of ops) {
    const current = made.get(op.key) ?? newest(op.key);
    if (
      op.t === "set"
        ? current?.t === "set" && isSame(current.value, op.value)
        : current === undefined || current.t === "del"
    ) {
      continue;
    }
    const at = new Date(
      Math.max(now, current ? current.at.getTime() + 1 : now),
    );
    const record: Unsequenced<SyncedRecord> =
      op.t === "set"
        ? { at, device, key: op.key, t: "set", value: op.value }
        : { at, device, key: op.key, t: "del" };
    made.set(op.key, record);
    records.push(record);
  }
  return records;
}

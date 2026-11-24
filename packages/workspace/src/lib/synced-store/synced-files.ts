import fs from "node:fs";
import path from "node:path";
import ms from "ms";
import { isEqual } from "radashi";

import { DEVICE_ID_PATTERN, type DeviceId } from "../records/device-id";
import { SyncedFold } from "./synced-fold";
import {
  checkDomain,
  isSyncedFileName,
  readSyncedLines,
  recordsFor,
  SYNCED_FORMAT,
  type SyncedOp,
  syncedFileName,
} from "./synced-record";
import { watchDevices } from "./watch-devices";

/**
 * A synced store read and written straight from its files, synchronously and
 * with nothing held between calls: the same files and lines as
 * `openSyncedStore`, for a store small enough to read whole on every use
 * whose readers are synchronous and file-level, such as the projects, which
 * the launch's migrations read and write before the workspace is up.
 *
 * Every call reads every device's file of the domain again, so a change
 * another device's file gained is seen at the next read. A process should
 * not also hold the domain open with `openSyncedStore`, whose writer would
 * not see these appends.
 */

/** How long a burst of watch events is gathered before a look. */
const SETTLE_MS = ms("250 milliseconds");

/** How often the files are looked at whatever the watch said. */
const LOOK_MS = ms("1 minute");

const DEVICE_FOLDER = new RegExp(`^${DEVICE_ID_PATTERN}$`);

/** Every device's file of the domain folded, as the files stand now. */
export function foldSyncedFiles({
  devicesDir,
  domain,
}: {
  devicesDir: string;
  domain: string;
}): SyncedFold {
  checkDomain(domain);
  const fold = new SyncedFold();
  for (const folder of namesIn(devicesDir)) {
    if (!DEVICE_FOLDER.test(folder)) {
      continue;
    }
    for (const name of namesIn(path.join(devicesDir, folder))) {
      if (!isSyncedFileName(name, domain)) {
        continue;
      }
      const file = path.join(devicesDir, folder, name);
      try {
        // oxlint-disable-next-line studio/no-sync-content-read -- synchronous on purpose: the callers are the projects' synchronous reads, and each file is a few lines per change.
        fold.add(file, fs.readFileSync(file));
      } catch {
        // A file that cannot be read now is read at the next call.
      }
    }
  }
  return fold;
}

/**
 * Appends the lines that make `ops` so to this device's file of the domain,
 * read against every device's file as they stand: an op that would change
 * nothing writes nothing (`recordsFor`). Answers the keys written.
 */
export function applySyncedOps({
  device,
  devicesDir,
  domain,
  now = Date.now(),
  ops,
}: {
  device: DeviceId;
  devicesDir: string;
  domain: string;
  now?: number;
  ops: readonly SyncedOp[];
}): string[] {
  const fold = foldSyncedFiles({ devicesDir, domain });
  const records = recordsFor(
    ops,
    (key) => fold.newest(key),
    device,
    now,
    isEqual,
  );
  if (records.length === 0) {
    return [];
  }
  for (const record of records) {
    const refusal = SYNCED_FORMAT.refusal(record);
    if (refusal !== undefined) {
      throw new Error(refusal);
    }
  }
  const file = path.join(devicesDir, device, syncedFileName(domain));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let held: Buffer;
  try {
    // oxlint-disable-next-line studio/no-sync-content-read -- the seq of the file's last line, read in the same run as the append so two appends cannot interleave.
    held = fs.readFileSync(file);
  } catch {
    held = Buffer.alloc(0);
  }
  const lastSeq = readSyncedLines(held).at(-1)?.record.seq ?? -1;
  // A line a crash cut short is ended first, so the next one reads whole.
  const lead = held.length > 0 && held.at(-1) !== 0x0a ? "\n" : "";
  const lines = records.map((record, index) =>
    SYNCED_FORMAT.line(record, lastSeq + 1 + index),
  );
  // oxlint-disable-next-line studio/no-sync-content-read -- an append to this device's own file, which it alone writes, in the same run as the read above.
  fs.appendFileSync(file, lead + lines.join(""), { flush: true });
  return records.map((record) => record.key);
}

/**
 * Calls `onChange` when any device's file of the domain changes, this
 * device's included, until the stop it returns is called. The files are
 * looked at again every `lookMs`, so a change the watch missed is late
 * rather than lost.
 */
export function watchSyncedFiles({
  devicesDir,
  domain,
  lookMs = LOOK_MS,
  onChange,
  onError = () => undefined,
  platform = process.platform,
}: {
  devicesDir: string;
  domain: string;
  lookMs?: number;
  onChange: () => void;
  /** Told of a watch that failed, which leaves the regular look. */
  onError?: (error: unknown) => void;
  platform?: NodeJS.Platform;
}): () => void {
  checkDomain(domain);
  let last = stampOf(devicesDir, domain);
  let settleTimer: NodeJS.Timeout | undefined;
  const look = () => {
    const now = stampOf(devicesDir, domain);
    if (now !== last) {
      last = now;
      onChange();
    }
  };
  const stopWatch = watchDevices({
    devicesDir,
    isOurs: (name) => isSyncedFileName(name, domain),
    onChange: () => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(look, SETTLE_MS);
    },
    onError,
    persistent: false,
    platform,
  });
  const lookTimer = setInterval(look, lookMs);
  lookTimer.unref();
  return () => {
    clearTimeout(settleTimer);
    clearInterval(lookTimer);
    stopWatch();
  };
}

/** Every device's file of the domain by name, size and time, as one string. */
function stampOf(devicesDir: string, domain: string): string {
  return namesIn(devicesDir)
    .filter((folder) => DEVICE_FOLDER.test(folder))
    .flatMap((folder) =>
      namesIn(path.join(devicesDir, folder))
        .filter((name) => isSyncedFileName(name, domain))
        .map((name) => path.join(folder, name)),
    )
    .toSorted()
    .map((file) => {
      try {
        const stat = fs.statSync(path.join(devicesDir, file));
        return `${file}\0${stat.size}:${stat.mtimeMs}`;
      } catch {
        // Gone since it was listed, or not readable now.
        return file;
      }
    })
    .join("\n");
}

function namesIn(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

import fs from "node:fs";
import path from "node:path";
import { isEqual } from "radashi";

import { DEVICE_ID_PATTERN, type DeviceId } from "../records/device-id";
import { RecordWriter } from "../records/record-writer";
import { readBytes } from "../workspace-files";
import { SyncedFold } from "./synced-fold";
import {
  checkDomain,
  isSyncedFileName,
  readSyncedLines,
  recordsFor,
  SYNCED_FORMAT,
  type SyncedOp,
  type SyncedRecord,
  syncedFileName,
} from "./synced-record";

/**
 * A synced store: keys and values every device sharing a workspace writes
 * and reads, kept as one append-only file per device
 * (`.instrument/devices/<device>/<domain>.jsonl`, `synced-record.ts`) so a
 * sync engine never has two versions of one file to choose between. Each
 * key is what its newest record says across every device's file
 * (`SyncedFold`).
 *
 * The store reads every device's file as it opens, appends this device's
 * changes to its own through a `RecordWriter`, and takes in what another
 * device's file gains: a watch on the devices folder notices, and `look()`
 * reads again for a change a watch missed. It holds the whole store in
 * memory, which suits a store of a few hundred keys; one that outgrows that
 * would index its files in `workspace.db`, as the activity log does.
 */
export interface SyncedStore {
  /**
   * Makes the changes, in order, in this device's file, answering once they
   * are on disk. A listener hears of the keys that changed before it answers.
   */
  apply(ops: readonly SyncedOp[]): Promise<void>;
  /** Stops watching. Writes already asked for still land. */
  close(): void;
  /** Every key that has a value, under `prefix` when one is given. */
  entries(prefix?: string): Map<string, unknown>;
  get(key: string): unknown;
  /**
   * Reads every other device's file for what it gained since it was last
   * read, answering once it has. Looks run one at a time, and a failed one
   * goes to `onError`.
   */
  look(): Promise<void>;
  /** Hears of the keys each change made here or arriving from elsewhere changed; answers the stop. */
  subscribe(listener: (keys: ReadonlySet<string>) => void): () => void;
}

export interface SyncedStoreOptions {
  /** This device, the only writer of its own file. */
  device: DeviceId;
  /** The workspace's devices folder (`workspaceLayout(…).devicesDir`). */
  devicesDir: string;
  /** What the store is, and its file's name: lowercase letters and digits. */
  domain: string;
  now?: () => number;
  onError?: (error: unknown) => void;
  platform?: NodeJS.Platform;
  /** How long a burst of watch events is gathered before a look. */
  settleMs?: number;
  /** Whether to watch the devices folder; off in tests that call `look` themselves. */
  watch?: boolean;
}

const SETTLE_MS = 250;
const DEVICE_FOLDER = new RegExp(`^${DEVICE_ID_PATTERN}$`);

/**
 * Opens a store, reading every device's file of it as it stands, downloading
 * any a cloud service keeps by name only.
 */
export async function openSyncedStore({
  device,
  devicesDir,
  domain,
  now = Date.now,
  onError = () => undefined,
  platform = process.platform,
  settleMs = SETTLE_MS,
  watch = true,
}: SyncedStoreOptions): Promise<SyncedStore> {
  checkDomain(domain);
  const fold = new SyncedFold();
  const listeners = new Set<(keys: ReadonlySet<string>) => void>();
  const ownDir = path.join(devicesDir, device);
  const ownFile = path.join(ownDir, syncedFileName(domain));
  /** Each other file as the last look saw it, by path. */
  const seen = new Map<string, { mtimeMs: number; size: number }>();
  let closed = false;

  const tell = (keys: ReadonlySet<string>) => {
    if (keys.size === 0) {
      return;
    }
    for (const listener of listeners) {
      try {
        listener(keys);
      } catch (error) {
        onError(error);
      }
    }
  };

  // This device's file is folded from what its writer writes, as it writes
  // it, and from its bytes on disk as the store opens.
  let ownBytes = await readIfThere(ownFile);
  fold.add(ownFile, ownBytes);
  let written = new Set<string>();
  const writer = new RecordWriter<SyncedRecord>(
    ownFile,
    SYNCED_FORMAT,
    {
      bytes: ownBytes,
      lastSeq: readSyncedLines(ownBytes).at(-1)?.record.seq ?? -1,
    },
    {
      onWrite: (bytes, offset) => {
        ownBytes = Buffer.concat([ownBytes.subarray(0, offset), bytes]);
        for (const key of fold.add(ownFile, ownBytes)) {
          written.add(key);
        }
      },
    },
  );

  /** Every file of the store in the devices folder but this device's own. */
  const otherFiles = (): string[] => {
    const files: string[] = [];
    for (const folder of namesIn(devicesDir)) {
      if (!DEVICE_FOLDER.test(folder)) {
        continue;
      }
      for (const name of namesIn(path.join(devicesDir, folder))) {
        const file = path.join(devicesDir, folder, name);
        if (file !== ownFile && isSyncedFileName(name, domain)) {
          files.push(file);
        }
      }
    }
    return files;
  };

  const lookOnce = async () => {
    if (closed) {
      return;
    }
    const changed = new Set<string>();
    for (const file of otherFiles()) {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      const last = seen.get(file);
      if (last?.size === stat.size && last.mtimeMs === stat.mtimeMs) {
        continue;
      }
      seen.set(file, { mtimeMs: stat.mtimeMs, size: stat.size });
      const bytes = await readIfThere(file);
      if (closed) {
        return;
      }
      for (const key of fold.add(file, bytes)) {
        changed.add(key);
      }
    }
    tell(changed);
  };

  let looking = Promise.resolve();
  const look = (): Promise<void> => {
    looking = looking.then(lookOnce).catch(onError);
    return looking;
  };

  // Watching from before the first look, so a change that lands while it
  // reads is looked at again.
  let stopWatch: (() => void) | undefined;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  if (watch) {
    const settle = () => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => void look(), settleMs);
    };
    stopWatch = watchDevices(devicesDir, platform, domain, settle, onError);
  }

  await look();

  return {
    apply: async (ops) => {
      const records = recordsFor(
        ops,
        (key) => fold.newest(key),
        device,
        now(),
        isEqual,
      );
      if (records.length === 0) {
        return;
      }
      fs.mkdirSync(ownDir, { recursive: true });
      const appended = records.map((record) => writer.append(record));
      try {
        await Promise.all(appended);
        await writer.commit();
      } finally {
        const keys = written;
        written = new Set();
        tell(keys);
      }
    },
    close: () => {
      closed = true;
      clearTimeout(settleTimer);
      stopWatch?.();
      listeners.clear();
    },
    entries: (prefix) => fold.entries(prefix),
    get: (key) => {
      const record = fold.newest(key);
      return record?.t === "set" ? record.value : undefined;
    },
    look,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Watches the devices folder for a device's file of the domain changing:
 * the folder as one tree where the system watches a tree with one handle
 * (macOS, Windows), and elsewhere the folder and each device's folder in it,
 * picking up a device's folder as it appears.
 */
function watchDevices(
  devicesDir: string,
  platform: NodeJS.Platform,
  domain: string,
  onChange: () => void,
  onError: (error: unknown) => void,
): () => void {
  try {
    fs.mkdirSync(devicesDir, { recursive: true });
  } catch (error) {
    onError(error);
    return () => undefined;
  }
  const isOurs = (name: string) => isSyncedFileName(name, domain);
  if (platform === "darwin" || platform === "win32") {
    return watchFolder(
      devicesDir,
      true,
      (filename) => {
        const [folder, name, ...deeper] = (filename ?? "").split(/[\\/]/);
        if (
          filename === null ||
          (folder !== undefined &&
            DEVICE_FOLDER.test(folder) &&
            name !== undefined &&
            deeper.length === 0 &&
            isOurs(name))
        ) {
          onChange();
        }
      },
      onError,
    );
  }
  const folders = new Map<string, () => void>();
  const attend = () => {
    for (const folder of namesIn(devicesDir)) {
      if (DEVICE_FOLDER.test(folder) && !folders.has(folder)) {
        folders.set(
          folder,
          watchFolder(
            path.join(devicesDir, folder),
            false,
            (name) => {
              if (name === null || isOurs(name)) {
                onChange();
              }
            },
            onError,
          ),
        );
      }
    }
  };
  attend();
  const stopTop = watchFolder(
    devicesDir,
    false,
    () => {
      attend();
      onChange();
    },
    onError,
  );
  return () => {
    stopTop();
    for (const stop of folders.values()) {
      stop();
    }
  };
}

/** Watches a folder, answering how to stop. A watch that fails is said and closed. */
function watchFolder(
  dir: string,
  recursive: boolean,
  onEvent: (filename: null | string) => void,
  onError: (error: unknown) => void,
): () => void {
  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(dir, { recursive }, (_event, filename) => {
      onEvent(filename);
    });
  } catch (error) {
    onError(error);
    return () => undefined;
  }
  watcher.on("error", (error) => {
    onError(error);
    watcher.close();
  });
  return () => {
    watcher.close();
  };
}

async function readIfThere(file: string): Promise<Buffer> {
  try {
    return await readBytes(file);
  } catch {
    return Buffer.alloc(0);
  }
}

function namesIn(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

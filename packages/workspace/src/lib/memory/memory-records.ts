import path from "node:path";
import { z } from "zod";

import { ChatIdSchema } from "../../schemas/chat-id";
import { type DeviceId } from "../../schemas/device-id";
import { writingChatRecords } from "../records/installed-records";
import {
  applySyncedOps,
  foldSyncedFiles,
  watchSyncedFiles,
} from "../synced-store/synced-files";
import { type SyncedOp } from "../synced-store/synced-record";
import { getWorkspaceConfig } from "../workspace-config";
import { workspaceLayout } from "../workspace-layout";

/**
 * What the app keeps about each memory apart from its words: the chat it was
 * learned in and when it was saved, in a synced store
 * (`docs/architecture/synced-stores.md`), each device appending to its own
 * `.instrument/devices/<device>/memory.jsonl`, a key per memory by its file's
 * name in `Memory/` (`pacific-time.md`), newest winning per key. The file is
 * the memory's text alone, so the person reads and edits nothing but it.
 *
 * A memory file renamed by hand is a memory the store has nothing about: it
 * shows with no chat and dated by the file. Matching it to the record it
 * left would also match a memory written by hand to one deleted by hand.
 */

const MEMORY_DOMAIN = "memory";

const MemoryRecordSchema = z.object({
  /** The chat it was learned in, when a chat saved it. */
  chat: ChatIdSchema.optional(),
  /** When it was saved or last corrected. */
  updated: z.iso.datetime({ offset: true }),
});

export type MemoryRecord = z.output<typeof MemoryRecordSchema>;

/** Where a memory folder's store is: in the devices folder of the workspace it is at the top of. */
function devicesDirOf(dir: string): string {
  return workspaceLayout(path.dirname(dir)).devicesDir;
}

/** Every memory's record, by its file's name, for the memory folder `dir`. */
export function readMemoryRecords(dir: string): Map<string, MemoryRecord> {
  const fold = foldSyncedFiles({
    devicesDir: devicesDirOf(dir),
    domain: MEMORY_DOMAIN,
  });
  const records = new Map<string, MemoryRecord>();
  for (const [fileName, value] of fold.entries()) {
    const parsed = MemoryRecordSchema.safeParse(value);
    if (parsed.success) {
      records.set(fileName, parsed.data);
    }
  }
  return records;
}

/** One change to a memory's record: set whole, or gone with its file. */
export type MemoryRecordOp =
  | { at?: number; fileName: string; record: MemoryRecord }
  | { fileName: string; gone: true };

/**
 * Writes the changes as `device`, the running workspace's when none is given.
 * One that would change nothing writes nothing.
 */
export function writeMemoryRecords(
  dir: string,
  ops: readonly MemoryRecordOp[],
  device?: DeviceId,
): void {
  if (ops.length === 0) {
    return;
  }
  applySyncedOps({
    device:
      device ?? writingChatRecords()?.device ?? getWorkspaceConfig().deviceId,
    devicesDir: devicesDirOf(dir),
    domain: MEMORY_DOMAIN,
    ops: ops.map(
      (op): SyncedOp =>
        "gone" in op
          ? { key: op.fileName, t: "del" }
          : {
              ...(op.at === undefined ? {} : { at: op.at }),
              key: op.fileName,
              t: "set",
              value: MemoryRecordSchema.parse(op.record),
            },
    ),
  });
}

/** Calls `onChange` when any device changes a memory's record, until stopped. */
export function watchMemoryRecords(
  dir: string,
  onChange: () => void,
): () => void {
  return watchSyncedFiles({
    devicesDir: devicesDirOf(dir),
    domain: MEMORY_DOMAIN,
    onChange,
  });
}

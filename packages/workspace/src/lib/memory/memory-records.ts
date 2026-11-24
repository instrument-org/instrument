import path from "node:path";
import { z } from "zod";

import { ChatIdSchema } from "../../schemas/chat-id";
import { type DeviceId } from "../../schemas/device-id";
import { heldStore } from "../synced-store/held-stores";
import { type SyncedOp } from "../synced-store/synced-record";
import { getWorkspaceConfig } from "../workspace-config";

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

const MemoryRecordSchema = z.object({
  /** The chat it was learned in, when a chat saved it. */
  chat: ChatIdSchema.optional(),
  /** When it was saved or last corrected. */
  updated: z.iso.datetime({ offset: true }),
});

export type MemoryRecord = z.output<typeof MemoryRecordSchema>;

/** The memory store of the workspace a memory folder is at the top of. */
function memoryStore(dir: string, device = getWorkspaceConfig().deviceId) {
  return heldStore("memory", { device, rootDir: path.dirname(dir) });
}

/** Every memory's record, by its file's name, for the memory folder `dir`. */
export async function readMemoryRecords(
  dir: string,
): Promise<Map<string, MemoryRecord>> {
  const store = await memoryStore(dir);
  const records = new Map<string, MemoryRecord>();
  for (const [fileName, value] of store.entries()) {
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
export async function writeMemoryRecords(
  dir: string,
  ops: readonly MemoryRecordOp[],
  device?: DeviceId,
): Promise<void> {
  const store = await memoryStore(dir, device);
  await store.exclusive(() =>
    store.apply(
      ops.map(
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
    ),
  );
}

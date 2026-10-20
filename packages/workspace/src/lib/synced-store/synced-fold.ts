import { compare, type Place } from "../records/fold";
import {
  readSyncedLines,
  type SyncedRecord,
  syncedPlace,
} from "./synced-record";

/**
 * Folding a synced store's files, every device's and every conflict copy of
 * one, into the newest record of each key (`syncedPlace`). A file is given
 * whole each time it is read, as far as it has arrived; a line is folded
 * once however many files and reads it arrives in, and a file that comes
 * back shorter (evicted, replaced) is read again from its start. The fold
 * comes to the same keys whatever order the files and their bytes arrive in.
 */
export class SyncedFold {
  /** How far each file was read, by the name it was given under. */
  readonly #read = new Map<string, number>();
  readonly #newest = new Map<string, { place: Place; record: SyncedRecord }>();
  /** Every line folded so far, by its place, so a copy of one folds once. */
  readonly #seen = new Set<string>();

  /**
   * Folds what a file has gained since it was last given, answering the keys
   * whose newest record changed.
   */
  add(file: string, bytes: Uint8Array): Set<string> {
    const changed = new Set<string>();
    const from = this.#read.get(file) ?? 0;
    const start = bytes.length < from ? 0 : from;
    const whole = bytes.lastIndexOf(0x0a) + 1;
    if (whole <= start) {
      this.#read.set(file, start);
      return changed;
    }
    this.#read.set(file, whole);
    for (const { line, record } of readSyncedLines(
      bytes.subarray(start, whole),
    )) {
      const place = syncedPlace(record, line);
      const seen = place.join(" ");
      if (this.#seen.has(seen)) {
        continue;
      }
      this.#seen.add(seen);
      const current = this.#newest.get(record.key);
      if (current && compare(current.place, place) >= 0) {
        continue;
      }
      this.#newest.set(record.key, { place, record });
      changed.add(record.key);
    }
    return changed;
  }

  /** The newest record of a key, a delete included. */
  newest(key: string): SyncedRecord | undefined {
    return this.#newest.get(key)?.record;
  }

  /** Every key whose newest record sets it, under `prefix` when one is given, with its value. */
  entries(prefix = ""): Map<string, unknown> {
    const entries = new Map<string, unknown>();
    for (const [key, { record }] of this.#newest) {
      if (record.t === "set" && key.startsWith(prefix)) {
        entries.set(key, record.value);
      }
    }
    return entries;
  }
}

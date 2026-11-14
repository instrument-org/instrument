import { isEqual } from "radashi";

import type {
  ComputerFolder,
  ComputerFolderEvent,
  ComputerListing,
} from "./computer";
import { compareEntries } from "./computer-entry-order";

/**
 * What changed between two reads of one folder, as the live listing sends
 * it: nothing when the two read the same, the whole of `next` when a
 * listing became a refusal or the other way round, and otherwise the
 * entries that are new or differ, the paths gone, and the listing's own
 * fields as they now stand.
 */
export function diffFolder(
  previous: ComputerFolder,
  next: ComputerFolder,
): ComputerFolderEvent | undefined {
  if (previous.kind !== "listing" || next.kind !== "listing") {
    return isEqual(previous, next)
      ? undefined
      : { folder: next, kind: "snapshot" };
  }
  const before = new Map(previous.entries.map((entry) => [entry.path, entry]));
  const upserts = next.entries.filter(
    (entry) => !isEqual(before.get(entry.path), entry),
  );
  const kept = new Set(next.entries.map((entry) => entry.path));
  const removed = previous.entries
    .filter((entry) => !kept.has(entry.path))
    .map((entry) => entry.path);
  const head = headOf(next);
  if (
    upserts.length === 0 &&
    removed.length === 0 &&
    isEqual(headOf(previous), head)
  ) {
    return undefined;
  }
  return { head, kind: "patch", removed, upserts };
}

/**
 * A folder with one event of its live listing applied. A patch names
 * entries by path rather than by place, so it lands right on any listing of
 * the folder, including one read since by another reader. Nothing when a
 * patch arrives for a folder not held as a listing, which only a fresh read
 * can answer.
 */
export function applyFolderPatch(
  previous: ComputerFolder | undefined,
  event: ComputerFolderEvent,
): ComputerFolder | undefined {
  if (event.kind === "snapshot") {
    return event.folder;
  }
  if (previous?.kind !== "listing") {
    return undefined;
  }
  const entries = new Map(previous.entries.map((entry) => [entry.path, entry]));
  for (const gone of event.removed) {
    entries.delete(gone);
  }
  for (const entry of event.upserts) {
    entries.set(entry.path, entry);
  }
  return {
    ...event.head,
    entries: [...entries.values()].toSorted(compareEntries),
  };
}

/** A listing's own fields, without its entries. */
function headOf({
  entries: _entries,
  ...head
}: ComputerListing): Omit<ComputerListing, "entries"> {
  return head;
}

import {
  fileNameMatchRank,
  fileNameWords,
  type FileNameMatchRank,
} from "@/shared/file-name-match";
import path from "node:path";
import { z } from "zod";

import { type FileNames } from "./walk";

export const FileNameEntrySchema = z.object({
  isFolder: z.boolean(),
  name: z.string(),
  path: z.string(),
});
export type FileNameEntry = z.output<typeof FileNameEntrySchema>;

/**
 * How long a finished walk answers searches before the next search starts
 * another. Nothing watches the folders, so this is how stale a name can be:
 * long enough that typing a few words walks once, short enough that a file
 * saved a moment ago is there the next time the person looks for it.
 */
const FRESH_FOR_MS = 60_000;

type Found = { at: number; rank: FileNameMatchRank };

/**
 * The entries of `names` the typed words find, best first and at most
 * `limit`: by the matcher's rank (`fileNameMatchRank`), then the shorter
 * name, then by name and by folder so the order is the same every time.
 */
export function searchFileNames(
  names: FileNames,
  typed: string,
  limit: number,
): FileNameEntry[] {
  const words = fileNameWords(typed);
  if (words.length === 0 || limit <= 0) {
    return [];
  }
  const folderOf = (at: number) => names.folders[names.parents[at] ?? -1] ?? "";
  const nameOf = (at: number) => names.folded[at] ?? "";
  const compare = (a: Found, b: Found) =>
    a.rank - b.rank ||
    nameOf(a.at).length - nameOf(b.at).length ||
    order(nameOf(a.at), nameOf(b.at)) ||
    order(folderOf(a.at), folderOf(b.at));
  // The best `limit` so far, in order. Most names that match are worse than
  // the last one kept, which is one comparison each, so a single letter that
  // matches nearly every name costs no sort of them all.
  const best: Found[] = [];
  for (const [at, name] of names.folded.entries()) {
    const rank = fileNameMatchRank(name, words);
    if (rank === undefined) {
      continue;
    }
    const found = { at, rank };
    const last = best.at(-1);
    if (best.length === limit && last && compare(found, last) >= 0) {
      continue;
    }
    const before = best.findIndex((kept) => compare(found, kept) < 0);
    best.splice(before === -1 ? best.length : before, 0, found);
    if (best.length > limit) {
      best.pop();
    }
  }
  return best.map(({ at }) => {
    const name = names.names[at] ?? "";
    return {
      isFolder: names.isFolder[at] ?? false,
      name,
      path: path.join(folderOf(at), name),
    };
  });
}

function order(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * An index of names kept fresh by being asked: the first search walks and
 * waits for it, and a later one answers from the last finished walk, starting
 * another behind it when that walk is older than `freshForMs`. One walk runs
 * at a time, and every search that comes in while it runs shares it.
 *
 * A search with no words answers nothing and waits for nothing, and still
 * starts a walk that is due: what a search box asks when it opens, so the
 * names are there by the first letter.
 */
export function createFileNameIndex({
  freshForMs = FRESH_FOR_MS,
  now = Date.now,
  walk,
}: {
  freshForMs?: number;
  now?: () => number;
  walk: () => Promise<FileNames>;
}) {
  let finished: undefined | { at: number; names: FileNames };
  let walking: Promise<void> | undefined;

  function refresh(): Promise<void> {
    walking ??= walk()
      .then((names) => {
        finished = { at: now(), names };
      })
      .finally(() => {
        walking = undefined;
      });
    return walking;
  }

  /** Whether a walk should start: none has finished, or the last is old and none is running. */
  function isDue(): boolean {
    return finished === undefined
      ? walking === undefined
      : walking === undefined && now() - finished.at >= freshForMs;
  }

  return {
    async search(typed: string, limit: number): Promise<FileNameEntry[]> {
      const isAsking = fileNameWords(typed).length > 0;
      if (finished === undefined && isAsking) {
        await refresh();
      } else if (isDue()) {
        // A walk that fails leaves the last finished one answering, and the
        // next search starts another.
        void refresh().catch(() => undefined);
      }
      return finished && isAsking
        ? searchFileNames(finished.names, typed, limit)
        : [];
    },
  };
}

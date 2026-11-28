import {
  type FoldedName,
  foldName,
  foldWords,
  matchRank,
  NO_MATCH,
} from "@/shared/name-match";
import path from "node:path";

import { walkFolder, type WalkedEntry } from "./folder-walk";

/** The kinds a search is narrowed to: folders, and files by extension (lowercase, no dot). */
export type KindFilter = { extensions: readonly string[]; folders: boolean };

/** Everything one search walked, each name folded once for every keystroke after. */
type Walked = {
  entries: { entry: WalkedEntry; name: FoldedName }[];
  /** The folders the walk stepped over and did not go on into, which Spotlight then fills in. */
  notSearched: string[];
};

/** Walks kept at once: one per search open in a Files tab, the oldest let go. */
const WALKS_KEPT = 4;

const walks = new Map<
  string,
  { controller: AbortController; walked: Promise<null | Walked> }
>();

/**
 * Everything under `root` for the search `walkId`, walked once when the
 * search starts and kept for its every keystroke after: `root` itself, with
 * the folders it steps over left out, and then each of `also` (folders the
 * person let the search into) on its own, listed under `root` as where they
 * are. Null when `root` cannot be read.
 */
export function walkForSearch({
  also,
  root,
  skips,
  walkId,
}: {
  also: readonly string[];
  root: string;
  /** The folders the walk from `root` steps over, `folderWalkSkips` by default. */
  skips?: ReadonlySet<string>;
  walkId: string;
}): Promise<null | Walked> {
  const kept = walks.get(walkId);
  if (kept) {
    walks.delete(walkId);
    walks.set(walkId, kept);
    return kept.walked;
  }
  const controller = new AbortController();
  const walked = walkAll({
    also,
    root,
    signal: controller.signal,
    ...(skips ? { skips } : {}),
  }).catch(() => null);
  walks.set(walkId, { controller, walked });
  for (const [oldest, walk] of walks) {
    if (walks.size <= WALKS_KEPT) break;
    walk.controller.abort();
    walks.delete(oldest);
  }
  return walked;
}

async function walkAll({
  also,
  root,
  signal,
  skips,
}: {
  also: readonly string[];
  root: string;
  signal: AbortSignal;
  skips?: ReadonlySet<string>;
}): Promise<null | Walked> {
  const [walk, ...more] = await Promise.all([
    walkFolder(root, { signal, ...(skips ? { skips } : {}) }),
    ...also.map((folder) => walkFolder(folder, { signal, skips: new Set() })),
  ]);
  if (!walk) {
    return null;
  }
  const entries = [...walk.entries];
  // A folder let in that the walk went into anyway is listed once.
  const listed = new Set(entries.map((entry) => entry.path));
  for (const [at, extra] of more.entries()) {
    const folder = also[at];
    if (!extra || folder === undefined) continue;
    const from = path.relative(root, folder).split(path.sep).join("/");
    for (const entry of extra.entries) {
      if (listed.has(entry.path)) continue;
      entries.push({
        ...entry,
        folder: entry.folder === "" ? from : `${from}/${entry.folder}`,
      });
    }
  }
  const walkedInto = new Set(also);
  return {
    entries: entries.map((entry) => ({ entry, name: foldName(entry.name) })),
    notSearched: walk.notSearched.filter((folder) => !walkedInto.has(folder)),
  };
}

/**
 * The entries whose names have every word of `query` the way the command
 * menu matches them, of the kinds `kinds` asks for; an empty query matches
 * every name.
 */
export function matchWalked(
  walked: Walked,
  { kinds, query }: { kinds?: KindFilter | undefined; query: string },
): WalkedEntry[] {
  const words = foldWords(query);
  const extensions = kinds ? new Set(kinds.extensions) : null;
  return walked.entries.flatMap(({ entry, name }) => {
    if (kinds && extensions) {
      const ofKind = entry.isFolder
        ? kinds.folders
        : extensions.has(path.extname(entry.name).slice(1).toLowerCase());
      if (!ofKind) return [];
    }
    return words.words.length === 0 || matchRank(name, words) !== NO_MATCH
      ? [entry]
      : [];
  });
}

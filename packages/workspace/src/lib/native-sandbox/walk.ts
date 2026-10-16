import { type Dirent, existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { DANGEROUS_NAMES } from "../permissions/places";

/** How far the search for names that run code goes into one folder. */
export interface WalkLimits {
  /** How many folders down a name may sit: 1 is the folder's own. */
  depth: number;
  /** How many entries one folder's search lists before it stops. */
  entries: number;
}

/**
 * Three folders down finds a repository in a folder of projects in an
 * allowed folder (`Documents/code/app/.git`). The entry cap keeps one command's start bounded however big
 * the folder is; the search goes shallow first, so what it leaves out is
 * the deepest.
 */
export const WALK_LIMITS: WalkLimits = { depth: 3, entries: 10_000 };

/** Folders too big to search that no one keeps a repository in. */
const UNSEARCHED = new Set(["node_modules"]);

/** What the search found: a name that runs code, or a `.git` folder or file. */
export interface FoundName {
  kind: "gitFile" | "name" | "repo";
  path: string;
}

/**
 * The names that run code already in `root`, and the repositories, each
 * `.git` file or folder, found breadth first down to `limits.depth` and no
 * further than `limits.entries` listed. Symlinks are not followed, and the
 * search stops at each of `stops`, a folder some other rule decides.
 */
export function namesThatRunCode(
  root: string,
  {
    dotEntriesOnly,
    limits,
    stops,
  }: {
    /** Only the root's hidden entries, for the rule over a home's. */
    dotEntriesOnly: boolean;
    limits: WalkLimits;
    stops: ReadonlySet<string>;
  },
): FoundName[] {
  const found: FoundName[] = [];
  const queue = [{ depth: 1, folder: root }];
  let listed = 0;
  for (const next of queue) {
    let entries: Dirent[];
    try {
      entries = readdirSync(next.folder, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (listed++ >= limits.entries) {
        return found;
      }
      if (dotEntriesOnly && next.depth === 1 && !entry.name.startsWith(".")) {
        continue;
      }
      const entryPath = path.join(next.folder, entry.name);
      if (stops.has(entryPath)) {
        continue;
      }
      if (entry.name === ".git") {
        found.push({
          kind: entry.isDirectory() ? "repo" : "gitFile",
          path: entryPath,
        });
        continue;
      }
      let named = false;
      for (const name of DANGEROUS_NAMES) {
        const [first, ...rest] = name.split("/");
        if (first !== entry.name) {
          continue;
        }
        if (rest.length === 0) {
          named = true;
          found.push({ kind: "name", path: entryPath });
        } else if (existsSync(path.join(next.folder, name))) {
          found.push({ kind: "name", path: path.join(next.folder, name) });
        }
      }
      if (
        !named &&
        entry.isDirectory() &&
        next.depth < limits.depth &&
        !UNSEARCHED.has(entry.name)
      ) {
        queue.push({ depth: next.depth + 1, folder: entryPath });
      }
    }
  }
  return found;
}

export function dotEntriesIn(folder: string): string[] {
  try {
    return readdirSync(folder)
      .filter((name) => name.startsWith("."))
      .map((name) => path.join(folder, name));
  } catch {
    return [];
  }
}

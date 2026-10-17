import { createHash } from "node:crypto";
import {
  type BigIntStats,
  type Dirent,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
} from "node:fs";
import path from "node:path";

import { resolveReal } from "./host";

/** What building a sandbox's policy asks of the disk, and the one change it makes. */
export interface Disk {
  exists: (target: string) => boolean;
  /** A folder's entries, or undefined where it cannot be listed. */
  list: (folder: string) => Dirent[] | undefined;
  /** Makes a folder and those above it; one that cannot be made is left. */
  makeFolder: (folder: string) => void;
  /** Where a path really is, through any link and past what is missing. */
  real: (target: string) => string;
}

export const liveDisk: Disk = {
  exists: existsSync,
  list: (folder) => {
    try {
      return readdirSync(folder, { withFileTypes: true });
    } catch {
      return undefined;
    }
  },
  makeFolder: (folder) => {
    try {
      mkdirSync(folder, { recursive: true });
    } catch {
      // Left as it is.
    }
  },
  real: resolveReal,
};

/**
 * Every path some answer came from, stamped. Where a path leads and whether
 * it is there depend only on what each part of the way is: the same file,
 * folder or link (same device, inode, mode and birth time, and a link's
 * same target) or missing still. What a folder lists depends on its
 * entries too, so a listed folder's stamp carries the names it holds, with
 * its times beside them. While every stamp is what it was, the disk gives
 * every answer it gave.
 */
export type DiskProof = ReadonlyMap<string, { listed: boolean; stamp: string }>;

/**
 * How long a change can go unseen in a listed folder's times: within one
 * tick of the disk's clock, a second change leaves the time the first one
 * set. FAT keeps times to two seconds, the coarsest of the disks a folder
 * may be on, so a folder changed that recently proves nothing.
 */
const UNSETTLED_MS = 2000;

/** Links followed from one path before the way is taken as a loop. */
const MAX_HOPS = 40;

/**
 * A path's own stats, or undefined where there is nothing to stat: missing,
 * under a file, or in a folder this account cannot search. Whichever it
 * was, getting past it changes a part of the way above it, stamped too.
 */
function statOf(target: string): BigIntStats | undefined {
  try {
    return lstatSync(target, { bigint: true, throwIfNoEntry: false });
  } catch {
    return undefined;
  }
}

function linkTarget(link: string): string | undefined {
  try {
    return readlinkSync(link);
  } catch {
    return undefined;
  }
}

/**
 * The names a folder holds, in one string. What a listing answers is the
 * names themselves, and a folder's times do not always follow them: on
 * Windows, making an entry in a folder moves neither its modification nor
 * its change time, so times alone hold a stamp while the entries move under
 * it, and a built policy would keep saying that the `.git` just made is not
 * there. "-" where the folder cannot be listed, as the stats are "-".
 */
function namesIn(folder: string): string {
  try {
    return createHash("sha1")
      .update(readdirSync(folder).toSorted().join("\0"))
      .digest("base64");
  } catch {
    return "-";
  }
}

function stampOf(
  target: string,
  stats: BigIntStats | undefined,
  listed: boolean,
): string {
  if (!stats) {
    return "-";
  }
  const what = `${stats.dev}:${stats.ino}:${stats.mode}:${stats.birthtimeNs}`;
  const leads = stats.isSymbolicLink() ? `>${linkTarget(target) ?? ""}` : "";
  const entries = listed
    ? `:${stats.mtimeNs}:${stats.ctimeNs}:${namesIn(target)}`
    : "";
  return `${what}${leads}${entries}`;
}

/** Whether every path in `proof` is as it was stamped. */
export function proofHolds(proof: DiskProof): boolean {
  for (const [target, { listed, stamp }] of proof) {
    if (stampOf(target, statOf(target), listed) !== stamp) {
      return false;
    }
  }
  return true;
}

/**
 * `disk`, answering as it does while it notes the paths each answer came
 * from: every part of the way to a path, the way any link on it leads, and
 * a listed folder's entries. Each is stamped before its answer is read, so
 * a change made meanwhile shows as a changed stamp. The proof is undefined
 * when a listed folder changed less than `UNSETTLED_MS` before `startedAt`,
 * or links lead round in a loop.
 */
export function recordingDisk(
  disk: Disk,
  startedAt: number,
): { disk: Disk; proof: () => DiskProof | undefined } {
  const noted = new Map<string, { listed: boolean; stamp: string }>();
  let provable = true;
  const note = (target: string, listed: boolean) => {
    const stats = statOf(target);
    noted.set(target, { listed, stamp: stampOf(target, stats, listed) });
    const changedAt =
      stats && Math.max(Number(stats.ctimeMs), Number(stats.mtimeMs));
    if (
      listed &&
      changedAt !== undefined &&
      changedAt > startedAt - UNSETTLED_MS
    ) {
      provable = false;
    }
    return stats;
  };
  /** Notes each part of the way to `target`, and where any link leads. */
  const noteWay = (target: string, hops = 0) => {
    if (hops > MAX_HOPS) {
      provable = false;
      return;
    }
    for (
      let part = path.resolve(target);
      !noted.has(part);
      part = path.dirname(part)
    ) {
      const stats = note(part, false);
      const leads = stats?.isSymbolicLink() ? linkTarget(part) : undefined;
      if (leads !== undefined) {
        noteWay(path.resolve(path.dirname(part), leads), hops + 1);
      }
      if (part === path.dirname(part)) {
        break;
      }
    }
  };
  return {
    disk: {
      exists: (target) => {
        noteWay(target);
        return disk.exists(target);
      },
      list: (folder) => {
        noteWay(folder);
        note(path.resolve(folder), true);
        return disk.list(folder);
      },
      makeFolder: disk.makeFolder,
      real: (target) => {
        noteWay(target);
        const real = disk.real(target);
        noteWay(real);
        return real;
      },
    },
    proof: () => (provable ? new Map(noted) : undefined),
  };
}

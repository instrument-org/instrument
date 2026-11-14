import ms from "ms";
import { watch as fsWatch } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { type ChatId } from "../../schemas/chat-id";
import {
  type ComputerEntry,
  type ComputerFolder,
  type ComputerFolderEvent,
  describeNamedEntries,
  type FolderNotes,
  readComputerFolder,
} from "./computer";
import { compareEntries } from "./computer-entry-order";
import { diffFolder } from "./computer-folder-patch";

/** How long a folder stays quiet before what changed in it is read. */
const SETTLE_MS = ms("150 milliseconds");
/** The longest a folder that keeps changing waits to be read. */
const MOST_WAIT_MS = ms("1 second");
/**
 * How often the folder itself is looked at while nothing is heard from it:
 * one stat, which finds a watch the system stopped serving (Linux, once the
 * folder is removed and made again), a folder renamed away (Windows says
 * nothing), and changes a watch never reports (a network share).
 */
const CHECK_MS = ms("5 seconds");
/** How often a folder that cannot be watched is read whole instead. */
const POLL_MS = ms("4 seconds");
/** Past this many names in one burst, the folder is read whole. */
const MOST_NAMES = 500;
/**
 * How far back from a folder's first read a change to it counts as made
 * while it was read, which the watch opened after the read never hears. The
 * coarsest file systems (HFS+, FAT) keep a folder's time to the second or two.
 */
const MTIME_SLACK_MS = ms("2 seconds");

/** The part of `fs.watch` this uses, so a test can stand in for the system. */
type Watch = (
  dir: string,
  listener: (event: string, filename: null | string) => void,
) => {
  close(): void;
  on(event: "error", listener: (error: Error) => void): unknown;
};

/**
 * A folder of the computer as it stays: the whole folder first, then each
 * change to it as a patch, until `signal` ends it. The folder is watched
 * (`fs.watch`, not recursive), and a change names the entries to look at
 * again rather than saying what happened to them, since systems name the
 * same change differently (macOS calls a write a rename). A named entry
 * already listed costs a stat; one new to the folder, a burst too large to
 * name, or a name the system lost has the folder read whole. Nothing is sent
 * while what was read matches what was sent.
 *
 * A folder that cannot be watched, or that the system refuses, is read whole
 * every few seconds instead, so a refusal undone fills it. One removed ends
 * the listing with the error a read of it would give (`ENOENT`).
 */
export async function* liveComputerFolder({
  chatId,
  path: asked,
  signal,
  timing = {},
  watch = fsWatch,
}: {
  chatId: ChatId;
  path: string;
  signal: AbortSignal;
  timing?: {
    checkMs?: number;
    mostWaitMs?: number;
    pollMs?: number;
    settleMs?: number;
  };
  watch?: Watch;
}): AsyncGenerator<ComputerFolderEvent> {
  const {
    checkMs = CHECK_MS,
    mostWaitMs = MOST_WAIT_MS,
    pollMs = POLL_MS,
    settleMs = SETTLE_MS,
  } = timing;
  const startedAt = Date.now();
  let read = await readComputerFolder({ chatId, path: asked });

  const heard = {
    firstAt: 0,
    /** That the system named the folder itself, or its watch failed. */
    itself: false,
    lastAt: 0,
    names: new Set<string>(),
    /** That the system lost the names (a Windows buffer overflow). */
    unnamed: false,
  };
  const isHeard = () => heard.itself || heard.unnamed || heard.names.size > 0;
  let wake: (() => void) | undefined;
  const nudge = () => wake?.();
  const sleep = (forMs: number) =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        wake = undefined;
        resolve();
      };
      const timer = setTimeout(done, Math.max(0, forMs));
      wake = done;
    });
  signal.addEventListener("abort", nudge, { once: true });

  let watcher: ReturnType<Watch> | undefined;
  const stopWatching = () => {
    watcher?.close();
    watcher = undefined;
  };
  const startWatching = (hostPath: string) => {
    try {
      const started = watch(hostPath, (_event, filename) => {
        const at = Date.now();
        if (!isHeard()) {
          heard.firstAt = at;
        }
        heard.lastAt = at;
        if (filename === null) {
          heard.unnamed = true;
        } else if (path.isAbsolute(filename)) {
          // Windows names the folder itself by its full path once it is
          // removed, and goes on naming it as fast as it can until the watch
          // is closed.
          heard.itself = true;
          stopWatching();
        } else {
          // macOS and Linux name the folder by its own name when it is
          // renamed; a child of the same name is looked at as well.
          if (filename === path.basename(hostPath)) {
            heard.itself = true;
          }
          if (heard.names.size < MOST_NAMES) {
            heard.names.add(filename);
          } else {
            heard.unnamed = true;
          }
        }
        nudge();
      });
      started.on("error", () => {
        heard.itself = true;
        stopWatching();
        nudge();
      });
      return started;
    } catch {
      return undefined;
    }
  };

  // A refused folder may refuse a stat as well, so only a listed one is looked at.
  const statOf = async (folder: ComputerFolder) =>
    folder.kind === "listing" ? await folderStat(folder.path) : undefined;
  let canWatch = true;
  let wholeAt = Date.now();
  const readWhole = async () => {
    const next = await readComputerFolder({ chatId, path: asked });
    wholeAt = Date.now();
    return next;
  };
  if (read.folder.kind === "listing") {
    watcher = startWatching(read.folder.path);
    canWatch = watcher !== undefined;
  }
  // The watch opens once the folder is read, so a folder changed while it
  // was read is read again once.
  let seen = await statOf(read.folder);
  if (seen !== undefined && seen.mtimeMs >= startedAt - MTIME_SLACK_MS) {
    heard.unnamed = true;
    heard.firstAt = heard.lastAt = Date.now();
  }
  let checkedAt = Date.now();
  try {
    yield { folder: read.folder, kind: "snapshot" };
    while (!signal.aborted) {
      // A watch closed on the folder's own account is opened again only once
      // the folder has been looked at.
      if (
        read.folder.kind === "listing" &&
        canWatch &&
        !watcher &&
        !heard.itself
      ) {
        watcher = startWatching(read.folder.path);
        canWatch = watcher !== undefined;
      }
      if (read.folder.kind !== "listing" || !canWatch) {
        await sleep(pollMs);
        if (signal.aborted) {
          return;
        }
        const next = await readWhole();
        yield* changed(read.folder, next.folder);
        read = next;
        seen = await statOf(read.folder);
        continue;
      }

      const now = Date.now();
      // A folder past its cap is read whole for any change, so it is read no
      // more often than one that cannot be watched.
      const due = isHeard()
        ? Math.max(
            Math.min(heard.lastAt + settleMs, heard.firstAt + mostWaitMs),
            read.folder.truncated ? wholeAt + pollMs : 0,
          )
        : checkedAt + checkMs;
      if (now < due) {
        await sleep(due - now);
        continue;
      }
      if (signal.aborted) {
        return;
      }

      // Whichever woke it, the folder is looked at first: a removed folder
      // ends the listing before anything is read in it, and a different
      // folder at the same path is watched again from scratch.
      const at = await folderStat(read.folder.path);
      checkedAt = Date.now();
      if (!at) {
        throw folderGone(read.folder.path);
      }
      const replaced = seen !== undefined && at.ino !== seen.ino;
      const missed =
        !isHeard() && seen !== undefined && at.mtimeMs !== seen.mtimeMs;
      if (!isHeard() && !replaced && !missed) {
        continue;
      }
      const taken = {
        itself: heard.itself,
        names: [...heard.names],
        unnamed: heard.unnamed,
      };
      heard.itself = false;
      heard.unnamed = false;
      heard.names.clear();
      // A watch that missed a change may have stopped serving the folder
      // (Linux, once it is removed and made again under the same inode).
      if (replaced || missed || taken.itself) {
        stopWatching();
      }

      const next =
        replaced || missed || taken.itself || taken.unnamed
          ? await readWhole()
          : await reread(read, taken.names, readWhole);
      yield* changed(read.folder, next.folder);
      read = next;
      seen = at;
      if (read.folder.kind !== "listing") {
        stopWatching();
      }
    }
  } finally {
    signal.removeEventListener("abort", nudge);
    stopWatching();
  }
}

/** The folder's identity and when its list of names last changed; nothing when it is gone. */
async function folderStat(
  hostPath: string,
): Promise<{ ino: number; mtimeMs: number } | undefined> {
  try {
    const stats = await fs.stat(hostPath);
    if (!stats.isDirectory()) {
      throw Object.assign(new Error(`Not a folder: ${hostPath}`), {
        code: "ENOTDIR",
      });
    }
    return { ino: stats.ino, mtimeMs: stats.mtimeMs };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

/** The error a read of a folder no longer there gives. */
function folderGone(hostPath: string) {
  return Object.assign(new Error(`Folder removed: ${hostPath}`), {
    code: "ENOENT",
  });
}

/** The patch from one read to the next, when they differ. */
function* changed(previous: ComputerFolder, next: ComputerFolder) {
  const event = diffFolder(previous, next);
  if (event) {
    yield event;
  }
}

/**
 * The folder with the named entries looked at again, or read whole when one
 * is new to it (no notes on it yet) or the listing is past its cap (an entry
 * added or gone changes which ones are kept).
 */
async function reread(
  read: { folder: ComputerFolder; notes: FolderNotes },
  names: readonly string[],
  readWhole: () => Promise<{ folder: ComputerFolder; notes: FolderNotes }>,
): Promise<{ folder: ComputerFolder; notes: FolderNotes }> {
  const { folder, notes } = read;
  if (folder.kind !== "listing" || folder.truncated) {
    return readWhole();
  }
  const listed = new Map(
    folder.entries.map((entry) => [entry.name.normalize("NFC"), entry]),
  );
  // An entry already listed is looked at under the name the folder's read
  // gave it, which its notes are kept by.
  const described = await describeNamedEntries(
    folder.path,
    names.map((name) => listed.get(name.normalize("NFC"))?.name ?? name),
    notes,
  );
  const entries = new Map(folder.entries.map((entry) => [entry.path, entry]));
  let removed = 0;
  for (const [index, name] of names.entries()) {
    const was = listed.get(name.normalize("NFC"));
    const now = described[index];
    if (was === undefined) {
      if (now !== undefined) {
        return readWhole();
      }
      // Made and removed within one burst: a save's temporary file.
      continue;
    }
    if (now === undefined) {
      if (entries.delete(was.path)) {
        removed += 1;
      }
      continue;
    }
    entries.set(was.path, keepName(now, was));
  }
  return {
    folder: {
      ...folder,
      entries: [...entries.values()].toSorted(compareEntries),
      total: folder.total - removed,
    },
    notes,
  };
}

/**
 * An entry described again under the name and path it was listed by, which
 * an event may spell in another Unicode form than the folder's read did.
 */
function keepName(entry: ComputerEntry, listed: ComputerEntry): ComputerEntry {
  return { ...entry, name: listed.name, path: listed.path };
}

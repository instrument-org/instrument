import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

/**
 * What the person browsing their own computer did to it from the Finder, kept
 * so ⌘Z can take it back: after the toast is gone, the window closed, or the
 * app restarted.
 *
 * Each entry carries the identity (device and inode) of the thing it made or
 * moved, as it was at the time. Undo puts back only that same thing, and only
 * into a place nothing has since taken: an item moved, replaced or filled in
 * since is refused with a reason, never half put back and never written over.
 */

const Identity = z.object({ dev: z.number(), ino: z.number() });
/** Which thing on disk an entry is about, whatever it is called now. */
export type Identity = z.output<typeof Identity>;

export const JournalEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    at: z.number(),
    from: z.string(),
    id: z.string(),
    identity: Identity,
    kind: z.literal("rename"),
    to: z.string(),
  }),
  z.object({
    at: z.number(),
    id: z.string(),
    identity: Identity,
    kind: z.literal("duplicate"),
    made: z.string(),
  }),
  z.object({
    at: z.number(),
    id: z.string(),
    identity: Identity,
    kind: z.literal("new-folder"),
    made: z.string(),
  }),
  z.object({
    at: z.number(),
    from: z.string(),
    id: z.string(),
    identity: Identity,
    kind: z.literal("trash"),
    /** Where it landed in the Trash, or null when the Trash could not be read to find it. */
    trashed: z.string().nullable(),
  }),
]);
export type JournalEntry = z.output<typeof JournalEntrySchema>;
/** An entry as an action reports it, before the journal stamps it. */
export type NewJournalEntry = JournalEntry extends infer Entry
  ? Entry extends JournalEntry
    ? Omit<Entry, "at" | "id">
    : never
  : never;

/** How many of the newest entries are kept. */
export const JOURNAL_LIMIT = 100;

/** Where the entries are kept between launches. */
export type JournalStorage = {
  read: () => JournalEntry[];
  write: (entries: JournalEntry[]) => void;
};

export type FileJournal = ReturnType<typeof createFileJournal>;

export function createFileJournal(
  storage: JournalStorage,
  {
    now = Date.now,
    makeId = () => crypto.randomUUID(),
  }: { makeId?: () => string; now?: () => number } = {},
) {
  return {
    /** One entry by its id, or null once it is undone or has aged out. */
    byId: (id: string) =>
      storage.read().find((entry) => entry.id === id) ?? null,
    /** The newest entry, the one ⌘Z takes back next. */
    latest: () => storage.read().at(-1) ?? null,
    record: (entry: NewJournalEntry) => {
      const recorded: JournalEntry = { ...entry, at: now(), id: makeId() };
      storage.write([...storage.read(), recorded].slice(-JOURNAL_LIMIT));
      return recorded;
    },
    remove: (id: string) => {
      storage.write(storage.read().filter((entry) => entry.id !== id));
    },
  };
}

/** The device and inode of what is at a path, without following a link; null when nothing is. */
export async function identityOf(at: string): Promise<Identity | null> {
  try {
    const stats = await fs.lstat(at);
    return { dev: stats.dev, ino: stats.ino };
  } catch {
    return null;
  }
}

function sameIdentity(left: Identity | null, right: Identity) {
  return left !== null && left.dev === right.dev && left.ino === right.ino;
}

/**
 * Whether `place` is free for `identity` to move into: nothing is there, or
 * what is there is that same thing under a name spelled with other letter
 * cases on a file system that does not tell them apart.
 */
async function isFreeFor(place: string, identity: Identity) {
  const there = await identityOf(place);
  return there === null || sameIdentity(there, identity);
}

/**
 * Where a thing just moved to the Trash landed, found by its identity among
 * the Trash's own entries: moving to the Trash on one disk keeps it, so it is
 * found whatever name the Trash gave it. Null when the Trash cannot be read,
 * which macOS can refuse an app without Full Disk Access.
 */
export async function findInTrash(
  identity: Identity,
  trashFolders = trashFoldersFor(identity),
): Promise<null | string> {
  for (const folder of await trashFolders) {
    try {
      for (const name of await fs.readdir(folder)) {
        const candidate = path.join(folder, name);
        if (sameIdentity(await identityOf(candidate), identity)) {
          return candidate;
        }
      }
    } catch {
      // Unreadable or absent: the next one, or nothing.
    }
  }
  return null;
}

/** The Trash folders that could hold something from the disk `identity` is on. */
async function trashFoldersFor(identity: Identity) {
  const home = path.join(os.homedir(), ".Trash");
  const folders = [home];
  // A disk other than the home one keeps its own Trash at its root.
  const homeIdentity = await identityOf(os.homedir());
  if (homeIdentity?.dev !== identity.dev) {
    try {
      const uid = os.userInfo().uid;
      for (const volume of await fs.readdir("/Volumes")) {
        folders.push(path.join("/Volumes", volume, ".Trashes", String(uid)));
      }
    } catch {
      // No volumes to look in.
    }
  }
  return folders;
}

export class UndoRefusedError extends Error {}

const nameOf = (at: string) => `“${path.basename(at)}”`;

/**
 * Takes one entry back, or refuses with what is in the way. Nothing here
 * deletes anything that is not provably what the entry made: a duplicate goes
 * to the Trash rather than away, and a folder is removed only while empty.
 *
 * Returns the path the thing is at once taken back, or null for something
 * taken back by being removed.
 */
export async function undoEntry(
  entry: JournalEntry,
  { trash }: { trash: (at: string) => Promise<void> },
): Promise<null | string> {
  switch (entry.kind) {
    case "rename": {
      if (!sameIdentity(await identityOf(entry.to), entry.identity)) {
        throw new UndoRefusedError(
          `${nameOf(entry.to)} has been moved or replaced since it was renamed.`,
        );
      }
      if (!(await isFreeFor(entry.from, entry.identity))) {
        throw new UndoRefusedError(
          `Something named ${nameOf(entry.from)} is already there.`,
        );
      }
      await fs.rename(entry.to, entry.from);
      return entry.from;
    }
    case "duplicate":
      if (!sameIdentity(await identityOf(entry.made), entry.identity)) {
        throw new UndoRefusedError(
          `${nameOf(entry.made)} has been moved or replaced since it was made.`,
        );
      }
      await trash(entry.made);
      return null;
    case "new-folder": {
      if (!sameIdentity(await identityOf(entry.made), entry.identity)) {
        throw new UndoRefusedError(
          `${nameOf(entry.made)} has been moved or replaced since it was made.`,
        );
      }
      try {
        // Removes only an empty folder, atomically: anything put in it since
        // is never at risk.
        await fs.rmdir(entry.made);
      } catch {
        throw new UndoRefusedError(
          `${nameOf(entry.made)} has something in it now.`,
        );
      }
      return null;
    }
    case "trash": {
      if (entry.trashed === null) {
        throw new UndoRefusedError(
          `Put ${nameOf(entry.from)} back from the Trash in the Finder.`,
        );
      }
      if (!sameIdentity(await identityOf(entry.trashed), entry.identity)) {
        throw new UndoRefusedError(
          `${nameOf(entry.from)} is no longer in the Trash.`,
        );
      }
      if (!(await isFreeFor(entry.from, entry.identity))) {
        throw new UndoRefusedError(
          `Something named ${nameOf(entry.from)} is already there.`,
        );
      }
      if ((await identityOf(path.dirname(entry.from))) === null) {
        throw new UndoRefusedError(
          `The folder ${nameOf(entry.from)} was in is gone.`,
        );
      }
      await fs.rename(entry.trashed, entry.from);
      return entry.from;
    }
  }
}

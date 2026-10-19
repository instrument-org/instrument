import { osConventionsFor } from "@/shared/os-conventions";
import { APP_NAME } from "@instrument-org/shared";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * What the person browsing their own computer did to it from the Finder in
 * this launch, kept so ⌘Z can take it back after the toast is gone or the
 * window closed. Like the Finder's own Edit > Undo, it ends with the app: an
 * action from an earlier launch is never what ⌘Z reaches.
 *
 * Each entry carries the identity (device and inode) of the thing it made or
 * moved, as it was at the time. Undo puts back only that same thing, and only
 * into a place nothing has since taken: an item moved, replaced or filled in
 * since is refused with a reason, never half put back and never written over.
 */

/**
 * Which thing on disk an entry is about, whatever it is called now. The inode
 * is kept as its digits: Node's number for an NTFS file id is rounded, so two
 * files could share one.
 */
export type Identity = { dev: number; ino: string };

/** Something moved to the Trash: from where, what it was, and where it landed, or null when the Trash could not be read to find it. */
export type Trashed = {
  from: string;
  identity: Identity;
  trashed: null | string;
};

export type JournalEntry = { at: number; id: string } & (
  | { from: string; identity: Identity; kind: "rename"; to: string }
  | { identity: Identity; kind: "duplicate"; made: string }
  | {
      kind: "copy";
      /** Each copy made into the folder, by where it was made and what it was. */
      made: { identity: Identity; path: string }[];
      /** What a copy took the place of, moved to the Trash. */
      replaced: Trashed[];
    }
  | {
      kind: "move";
      /** What a drop of the Finder's own rows moved, from where to where, and what each was. */
      moved: { from: string; identity: Identity; to: string }[];
      /** What the same drop copied instead, onto another disk. */
      made: { identity: Identity; path: string }[];
      /** What a moved or copied item took the place of, moved to the Trash. */
      replaced: Trashed[];
      /** What was moved onto another disk, copied there and then moved to the Trash. */
      left: Trashed[];
    }
  | { identity: Identity; kind: "new-folder"; made: string }
  | {
      from: string;
      identity: Identity;
      kind: "trash";
      /** Where it landed in the Trash, or null when the Trash could not be read to find it. */
      trashed: null | string;
    }
);
/** An entry as an action reports it, before the journal stamps it. */
export type NewJournalEntry = JournalEntry extends infer Entry
  ? Entry extends JournalEntry
    ? Omit<Entry, "at" | "id">
    : never
  : never;

/** How many of the newest entries are kept. */
export const JOURNAL_LIMIT = 100;

export function createFileJournal({
  now = Date.now,
  makeId = () => crypto.randomUUID(),
}: { makeId?: () => string; now?: () => number } = {}) {
  let entries: JournalEntry[] = [];
  return {
    /** One entry by its id, or null once it is undone or has aged out. */
    byId: (id: string) => entries.find((entry) => entry.id === id) ?? null,
    /** Every entry kept, oldest first. */
    entries: () => entries,
    /** The newest entry, the one ⌘Z takes back next. */
    latest: () => entries.at(-1) ?? null,
    record: (entry: NewJournalEntry) => {
      const recorded: JournalEntry = { ...entry, at: now(), id: makeId() };
      entries = [...entries, recorded].slice(-JOURNAL_LIMIT);
      return recorded;
    },
    remove: (id: string) => {
      entries = entries.filter((entry) => entry.id !== id);
    },
  };
}

/** This launch's journal, which every Finder action writes to. */
export const fileJournal = createFileJournal();

/**
 * The device and inode of what is at a path, without following a link; null
 * when nothing is. The inode is read whole, as a bigint, since the number
 * Node otherwise gives for an NTFS file id is rounded.
 */
export async function identityOf(at: string): Promise<Identity | null> {
  try {
    const stats = await fs.lstat(at, { bigint: true });
    return { dev: Number(stats.dev), ino: String(stats.ino) };
  } catch {
    return null;
  }
}

/** How an identity is read off a path: `identityOf`, or a stand-in in a test. */
type Stat = (at: string) => Promise<Identity | null>;

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
 * found whatever name the Trash gave it.
 *
 * Where the Trash keeps a record of each item (the Recycle Bin's `$I` files,
 * the freedesktop Trash's `.trashinfo`), only the items whose record says
 * they came from `from` are looked at, and when several of those share the
 * identity the newest deletion is the one. The Finder keeps no record the
 * app can read, so there the items named like it are looked at first. Null
 * when the Trash cannot be read, which macOS can refuse an app without Full
 * Disk Access.
 */
export async function findInTrash(
  identity: Identity,
  {
    from,
    home = os.homedir(),
    platform = process.platform,
    stat = identityOf,
    uid = currentUid(),
    folders = trashFoldersFor({ from, home, identity, platform, stat, uid }),
  }: {
    folders?: Promise<string[]>;
    /** Where it was before it was trashed. */
    from: string;
    home?: string;
    platform?: NodeJS.Platform;
    stat?: Stat;
    /** The account's id, which names its Trash on another disk; null where the system gives none. */
    uid?: null | number;
  },
): Promise<null | string> {
  let newest: null | { at: string; deletedAt: number } = null;
  for (const folder of await folders) {
    let candidates: Candidate[];
    try {
      candidates = await candidatesIn(folder, from, platform);
    } catch {
      // Unreadable or absent: the next one, or nothing.
      continue;
    }
    for (const { at, deletedAt } of candidates) {
      if (!sameIdentity(await stat(at), identity)) {
        continue;
      }
      if (deletedAt === null) {
        // The Finder's Trash keeps no record of when, and an inode there is
        // whole, so the first item that has it is the one.
        return at;
      }
      if (newest === null || deletedAt > newest.deletedAt) {
        newest = { at, deletedAt };
      }
    }
  }
  return newest?.at ?? null;
}

/** This account's id, or null where the system has none to give. */
function currentUid() {
  try {
    return os.userInfo().uid;
  } catch {
    return null;
  }
}

/** An item in a Trash folder that could be the one looked for, with when it was deleted where the Trash records that. */
type Candidate = { at: string; deletedAt: null | number };

/** The items in one Trash folder that could be the one trashed from `from`, in the order to look at them. */
async function candidatesIn(
  folder: string,
  from: string,
  platform: NodeJS.Platform,
): Promise<Candidate[]> {
  if (platform === "darwin") {
    // The Finder keeps the name, adding the time when it is taken, so the
    // items that start with its stem come first.
    const stem = path.parse(from).name;
    const names = await fs.readdir(folder);
    return [
      ...names.filter((name) => name.startsWith(stem)),
      ...names.filter((name) => !name.startsWith(stem)),
    ].map((name) => ({ at: path.join(folder, name), deletedAt: null }));
  }
  const records =
    platform === "win32" ? folder : path.join(path.dirname(folder), "info");
  const candidates: Candidate[] = [];
  for (const name of await fs.readdir(records)) {
    const trashed = trashedOf(folder, name, platform);
    const record =
      trashed === null ? null : await trashRecordOf(trashed, platform);
    if (
      trashed !== null &&
      record !== null &&
      samePlace(record.from, from, platform)
    ) {
      candidates.push({ at: trashed, deletedAt: record.deletedAt });
    }
  }
  return candidates;
}

/** The item in `folder` a record is about, by the record's name; null for anything else beside the records. */
function trashedOf(folder: string, record: string, platform: NodeJS.Platform) {
  if (platform === "win32") {
    return record.startsWith("$I")
      ? path.join(folder, `$R${record.slice(2)}`)
      : null;
  }
  return record.endsWith(".trashinfo")
    ? path.join(folder, record.slice(0, -".trashinfo".length))
    : null;
}

/** Whether two paths name one place, regardless of letter case on Windows. */
function samePlace(left: string, right: string, platform: NodeJS.Platform) {
  return platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

/** The Trash folders that could hold something from the disk `identity` is on. */
async function trashFoldersFor({
  from,
  home,
  identity,
  platform,
  stat,
  uid,
}: {
  from: string;
  home: string;
  identity: Identity;
  platform: NodeJS.Platform;
  stat: Stat;
  uid: null | number;
}) {
  switch (platform) {
    case "darwin": {
      // What is trashed from iCloud Drive waits in a Trash of its own, which
      // the Finder shows merged into the home folder's.
      const folders = [
        path.join(home, ".Trash"),
        // oxlint-disable-next-line studio/no-os-words -- a macOS path, never shown
        path.join(home, "Library", "Mobile Documents", ".Trash"),
      ];
      // A disk other than the home one keeps its own Trash at its root.
      if ((await stat(home))?.dev !== identity.dev && uid !== null) {
        try {
          for (const volume of await fs.readdir("/Volumes")) {
            folders.push(
              path.join("/Volumes", volume, ".Trashes", String(uid)),
            );
          }
        } catch {
          // No volumes to look in.
        }
      }
      return folders;
    }
    case "win32": {
      // Each drive keeps a Recycle Bin at its root, with a folder for each
      // account; only this account's can be read.
      const bin = path.join(path.parse(from).root, "$Recycle.Bin");
      try {
        return (await fs.readdir(bin)).map((account) =>
          path.join(bin, account),
        );
      } catch {
        return [];
      }
    }
    default: {
      // The freedesktop Trash: the home one, and for another disk the one at
      // the top of that disk.
      const dataHome =
        process.env.XDG_DATA_HOME || path.join(home, ".local/share");
      const folders = [path.join(dataHome, "Trash", "files")];
      if ((await stat(dataHome))?.dev !== identity.dev && uid !== null) {
        const top = await topOfDisk(path.dirname(from), identity.dev, stat);
        folders.push(
          path.join(top, ".Trash", String(uid), "files"),
          path.join(top, `.Trash-${uid}`, "files"),
        );
      }
      return folders;
    }
  }
}

/** The highest folder above `folder` that is still on the disk `dev`. */
async function topOfDisk(folder: string, dev: number, stat: Stat) {
  let top = folder;
  while (
    path.dirname(top) !== top &&
    (await stat(path.dirname(top)))?.dev === dev
  ) {
    top = path.dirname(top);
  }
  return top;
}

/**
 * What the Trash records about a trashed item: where it came from, and when
 * it was deleted in milliseconds. Null where the Trash keeps no record or it
 * cannot be read.
 */
async function trashRecordOf(
  trashed: string,
  platform: NodeJS.Platform,
): Promise<null | { deletedAt: number; from: string }> {
  const record = recordOf(trashed, platform);
  if (record === null) {
    return null;
  }
  try {
    return platform === "win32"
      ? recycleRecord(await fs.readFile(record))
      : trashInfo(await fs.readFile(record, "utf8"), trashed);
  } catch {
    return null;
  }
}

/** Milliseconds from 1601, where a Windows file time counts from, to 1970. */
const FILE_TIME_EPOCH_MS = 11_644_473_600_000;

/**
 * A Recycle Bin `$I` record: a version, the size, the deletion time at byte
 * 16 in 100-nanosecond ticks since 1601, then the path in UTF-16, counted in
 * version 2 (Windows 10 and later) or in a fixed 260-character field in
 * version 1.
 */
function recycleRecord(bytes: Buffer) {
  const text =
    bytes.readBigUInt64LE(0) === 2n
      ? bytes.subarray(28, 28 + 2 * bytes.readUInt32LE(24))
      : bytes.subarray(24, 24 + 520);
  return {
    deletedAt: Number(bytes.readBigUInt64LE(16) / 10_000n) - FILE_TIME_EPOCH_MS,
    from: text.toString("utf16le").replace(/\0.*$/s, ""),
  };
}

/**
 * A freedesktop `.trashinfo`: `Path=` is where the item came from, escaped
 * as a URL path, and in the Trash at the top of a disk relative to that top;
 * `DeletionDate=` is when, in local time.
 */
function trashInfo(text: string, trashed: string) {
  const kept = /^Path=(.*)$/m.exec(text)?.[1];
  if (kept === undefined) {
    return null;
  }
  const written = decodeURIComponent(kept);
  const deletedAt = Date.parse(/^DeletionDate=(.*)$/m.exec(text)?.[1] ?? "");
  return {
    deletedAt: Number.isNaN(deletedAt) ? 0 : deletedAt,
    from: path.isAbsolute(written)
      ? written
      : path.join(topOfTrash(trashed), written),
  };
}

/** The top of the disk a trashed item's Trash is at: above `.Trash-<uid>`, or above `.Trash/<uid>`. */
function topOfTrash(trashed: string) {
  const trash = path.dirname(path.dirname(trashed));
  return path.basename(trash).startsWith(".Trash-")
    ? path.dirname(trash)
    : path.dirname(path.dirname(trash));
}

/**
 * The file the Trash keeps about a trashed item, to list it and to put it
 * back: a `.trashinfo` in the freedesktop Trash, a `$I` record in the Recycle
 * Bin. The Finder keeps its own, which is left to it.
 */
function recordOf(trashed: string, platform: NodeJS.Platform) {
  const name = path.basename(trashed);
  switch (platform) {
    case "darwin": {
      return null;
    }
    case "win32": {
      return name.startsWith("$R")
        ? path.join(path.dirname(trashed), `$I${name.slice(2)}`)
        : null;
    }
    default: {
      const files = path.dirname(trashed);
      return path.basename(files) === "files"
        ? path.join(path.dirname(files), "info", `${name}.trashinfo`)
        : null;
    }
  }
}

/**
 * Whether what is at `trashed` is still the item an entry moved to the
 * Trash: the same identity, and where the Trash keeps a record, one that
 * still says it came from `from`.
 */
async function isStillTrashed(
  trashed: string,
  { from, identity }: { from: string; identity: Identity },
  platform: NodeJS.Platform,
) {
  if (!sameIdentity(await identityOf(trashed), identity)) {
    return false;
  }
  if (recordOf(trashed, platform) === null) {
    return true;
  }
  const record = await trashRecordOf(trashed, platform);
  return record !== null && samePlace(record.from, from, platform);
}

/**
 * Why an entry cannot be taken back. A `permanent` refusal is one nothing the
 * person can do will lift, the thing having gone from where the entry left
 * it, so the entry can go once it has said why; any other waits for the
 * person to clear the way and try again.
 */
export class UndoRefusedError extends Error {
  readonly permanent: boolean;

  constructor(message: string, { permanent }: { permanent: boolean }) {
    super(message);
    this.permanent = permanent;
  }
}

const nameOf = (at: string) => `“${path.basename(at)}”`;

/** What taking an entry back did. */
export type Undone = {
  /** Whether it was already back, put there by hand, so nothing was done. */
  already: boolean;
  /** Where the thing is now, or null for something taken back by being removed. */
  path: null | string;
};

/**
 * Refuses, with the reason, to put back something moved to the Trash: it
 * was never found there, has left it, or the folder it came from is gone.
 * Whether its old place is free is the caller's, since one taken by what
 * replaced it is cleared by the same undo.
 */
async function refuseTrashedBack(item: Trashed, platform: NodeJS.Platform) {
  const conventions = osConventionsFor(platform);
  if (item.trashed === null) {
    throw new UndoRefusedError(
      `${APP_NAME} couldn't find ${nameOf(item.from)} in the ${conventions.trash}. You can put it back from there in ${conventions.inFileManager}.`,
      { permanent: true },
    );
  }
  if (!(await isStillTrashed(item.trashed, item, platform))) {
    throw new UndoRefusedError(
      `${nameOf(item.from)} is no longer in the ${conventions.trash}.`,
      { permanent: true },
    );
  }
  if ((await identityOf(path.dirname(item.from))) === null) {
    throw new UndoRefusedError(
      `The folder ${nameOf(item.from)} was in is gone.`,
      { permanent: true },
    );
  }
}

/** Moves something back out of the Trash, once `refuseTrashedBack` has passed it. */
async function putTrashedBack(
  { from, trashed }: Trashed & { trashed: string },
  platform: NodeJS.Platform,
) {
  await fs.rename(trashed, from);
  const record = recordOf(trashed, platform);
  if (record !== null) {
    // It is back either way; a record left behind would only list it in
    // the Trash as something that can no longer be put back.
    await fs.rm(record, { force: true }).catch(() => undefined);
  }
}

/**
 * Something moved to the Trash a moment ago put back where it was, by a
 * step that failed after it: refused with the reason when it cannot be.
 */
export async function restoreFromTrash(
  item: Trashed,
  platform: NodeJS.Platform = process.platform,
) {
  await refuseTrashedBack(item, platform);
  if (!(await isFreeFor(item.from, item.identity))) {
    throw new UndoRefusedError(
      `Something named ${nameOf(item.from)} is already there.`,
      { permanent: false },
    );
  }
  if (item.trashed !== null) {
    await putTrashedBack({ ...item, trashed: item.trashed }, platform);
  }
}

/**
 * Takes back a drop or paste into a folder: what was moved goes back where it
 * came from, what was copied goes to the Trash, and what was moved to the
 * Trash along the way (what was replaced, and the sources of a move onto
 * another disk) comes back out. Every piece is checked before any is
 * touched, so it all comes back or none of it does.
 */
async function undoPlacing(
  {
    left = [],
    made,
    moved = [],
    replaced,
  }: {
    left?: readonly Trashed[];
    made: readonly { identity: Identity; path: string }[];
    moved?: readonly { from: string; identity: Identity; to: string }[];
    replaced: readonly Trashed[];
  },
  {
    platform,
    trash,
  }: { platform: NodeJS.Platform; trash: (at: string) => Promise<void> },
): Promise<Undone> {
  for (const item of moved) {
    if (!sameIdentity(await identityOf(item.to), item.identity)) {
      throw new UndoRefusedError(
        `${nameOf(item.to)} has been moved or replaced since it was moved.`,
        { permanent: true },
      );
    }
    if (!(await isFreeFor(item.from, item.identity))) {
      throw new UndoRefusedError(
        `Something named ${nameOf(item.from)} is already there.`,
        { permanent: false },
      );
    }
  }
  for (const item of made) {
    if (!sameIdentity(await identityOf(item.path), item.identity)) {
      throw new UndoRefusedError(
        `${nameOf(item.path)} has been moved or replaced since it was copied.`,
        { permanent: true },
      );
    }
  }
  // What was replaced goes back to its own name, which only what replaced
  // it may hold now: that is taken back first.
  const placed = [...moved, ...made].map((item) => item.identity);
  for (const item of replaced) {
    await refuseTrashedBack(item, platform);
    const there = await identityOf(item.from);
    if (there && !placed.some((each) => sameIdentity(each, there))) {
      throw new UndoRefusedError(
        `Something named ${nameOf(item.from)} is already there.`,
        { permanent: false },
      );
    }
  }
  for (const item of left) {
    await refuseTrashedBack(item, platform);
    if (!(await isFreeFor(item.from, item.identity))) {
      throw new UndoRefusedError(
        `Something named ${nameOf(item.from)} is already there.`,
        { permanent: false },
      );
    }
  }
  for (const item of moved) {
    await fs.rename(item.to, item.from);
  }
  for (const item of made) {
    await trash(item.path);
  }
  for (const item of [...left, ...replaced]) {
    if (item.trashed !== null) {
      await putTrashedBack({ ...item, trashed: item.trashed }, platform);
    }
  }
  return {
    already: false,
    path: moved[0]?.from ?? left[0]?.from ?? null,
  };
}

/**
 * Takes one entry back, or refuses with what is in the way. Nothing here
 * deletes anything that is not provably what the entry made: a duplicate goes
 * to the Trash rather than away, and a folder is removed only while empty.
 */
export async function undoEntry(
  entry: JournalEntry,
  {
    platform = process.platform,
    trash,
  }: { platform?: NodeJS.Platform; trash: (at: string) => Promise<void> },
): Promise<Undone> {
  switch (entry.kind) {
    case "rename": {
      if (!sameIdentity(await identityOf(entry.to), entry.identity)) {
        throw new UndoRefusedError(
          `${nameOf(entry.to)} has been moved or replaced since it was renamed.`,
          { permanent: true },
        );
      }
      if (!(await isFreeFor(entry.from, entry.identity))) {
        throw new UndoRefusedError(
          `Something named ${nameOf(entry.from)} is already there.`,
          { permanent: false },
        );
      }
      await fs.rename(entry.to, entry.from);
      return { already: false, path: entry.from };
    }
    case "duplicate":
      if (!sameIdentity(await identityOf(entry.made), entry.identity)) {
        throw new UndoRefusedError(
          `${nameOf(entry.made)} has been moved or replaced since it was made.`,
          { permanent: true },
        );
      }
      await trash(entry.made);
      return { already: false, path: null };
    case "copy":
    case "move":
      return undoPlacing(entry, { platform, trash });
    case "new-folder": {
      if (!sameIdentity(await identityOf(entry.made), entry.identity)) {
        throw new UndoRefusedError(
          `${nameOf(entry.made)} has been moved or replaced since it was made.`,
          { permanent: true },
        );
      }
      try {
        // Removes only an empty folder, atomically: anything put in it since
        // is never at risk.
        await fs.rmdir(entry.made);
      } catch {
        throw new UndoRefusedError(
          `${nameOf(entry.made)} has something in it now.`,
          { permanent: false },
        );
      }
      return { already: false, path: null };
    }
    case "trash": {
      if (sameIdentity(await identityOf(entry.from), entry.identity)) {
        return { already: true, path: entry.from };
      }
      await refuseTrashedBack(entry, platform);
      if (!(await isFreeFor(entry.from, entry.identity))) {
        throw new UndoRefusedError(
          `Something named ${nameOf(entry.from)} is already there.`,
          { permanent: false },
        );
      }
      if (entry.trashed !== null) {
        await putTrashedBack({ ...entry, trashed: entry.trashed }, platform);
      }
      return { already: false, path: entry.from };
    }
  }
}

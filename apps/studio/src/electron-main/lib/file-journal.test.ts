import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createFileJournal,
  findInTrash,
  identityOf,
  JOURNAL_LIMIT,
  JournalEntrySchema,
  type JournalEntry,
  type NewJournalEntry,
  undoEntry,
  UndoRefusedError,
} from "./file-journal";

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "file-journal-"));
});
afterEach(async () => {
  await fs.rm(dir, { force: true, recursive: true });
});

const at = (name: string) => path.join(dir, name);
const listed = async () => (await fs.readdir(dir)).sort();
async function identity(name: string) {
  const found = await identityOf(at(name));
  if (!found) throw new Error(`${name} is not there`);
  return found;
}
/** A trash that moves things into a folder beside them, as the real one keeps the inode. */
async function moveToTrash(thing: string) {
  await fs.mkdir(at(".trash"), { recursive: true });
  await fs.rename(thing, at(`.trash/${path.basename(thing)} 12.00.00`));
}
const trash = vi.fn(moveToTrash);

async function undo(entry: NewJournalEntry) {
  return undoEntry({ ...entry, at: 0, id: "entry" }, { trash });
}

describe("undoing a rename", () => {
  it("puts the old name back", async () => {
    await fs.writeFile(at("plans.txt"), "kept");
    const entry = {
      from: at("notes.txt"),
      identity: await identity("plans.txt"),
      kind: "rename" as const,
      to: at("plans.txt"),
    };

    expect(await undo(entry)).toBe(at("notes.txt"));
    expect(await listed()).toEqual(["notes.txt"]);
    expect(await fs.readFile(at("notes.txt"), "utf8")).toBe("kept");
  });

  it("refuses when something has taken the old name since", async () => {
    await fs.writeFile(at("plans.txt"), "renamed");
    await fs.writeFile(at("notes.txt"), "someone else's");
    const entry = {
      from: at("notes.txt"),
      identity: await identity("plans.txt"),
      kind: "rename" as const,
      to: at("plans.txt"),
    };

    await expect(undo(entry)).rejects.toThrow(UndoRefusedError);
    expect(await fs.readFile(at("notes.txt"), "utf8")).toBe("someone else's");
    expect(await fs.readFile(at("plans.txt"), "utf8")).toBe("renamed");
  });

  it("refuses when the renamed thing has been replaced since", async () => {
    await fs.writeFile(at("plans.txt"), "renamed");
    const before = await identity("plans.txt");
    // Moved away rather than deleted, so the new file cannot be handed the
    // inode the old one freed, which Linux filesystems do at once.
    const movedAway = `${dir}-moved-away.txt`;
    await fs.rename(at("plans.txt"), movedAway);
    await fs.writeFile(at("plans.txt"), "a new file under the same name");

    await expect(
      undo({
        from: at("notes.txt"),
        identity: before,
        kind: "rename",
        to: at("plans.txt"),
      }),
    ).rejects.toThrow("has been moved or replaced");
    expect(await listed()).toEqual(["plans.txt"]);
    await fs.rm(movedAway);
  });
});

describe("undoing what was made", () => {
  it("sends a duplicate to the Trash rather than deleting it", async () => {
    await fs.writeFile(at("notes copy.txt"), "copy");

    expect(
      await undo({
        identity: await identity("notes copy.txt"),
        kind: "duplicate",
        made: at("notes copy.txt"),
      }),
    ).toBeNull();
    expect(trash).toHaveBeenCalledWith(at("notes copy.txt"));
  });

  it("removes a new folder that is still empty", async () => {
    await fs.mkdir(at("untitled folder"));

    await undo({
      identity: await identity("untitled folder"),
      kind: "new-folder",
      made: at("untitled folder"),
    });
    expect(await listed()).toEqual([]);
  });

  it("keeps a new folder that has something in it now", async () => {
    await fs.mkdir(at("untitled folder"));
    await fs.writeFile(at("untitled folder/draft.txt"), "work");

    await expect(
      undo({
        identity: await identity("untitled folder"),
        kind: "new-folder",
        made: at("untitled folder"),
      }),
    ).rejects.toThrow("has something in it now");
    expect(await fs.readFile(at("untitled folder/draft.txt"), "utf8")).toBe(
      "work",
    );
  });
});

describe("undoing a move to the Trash", () => {
  it("finds what was trashed by its identity and puts it back", async () => {
    await fs.writeFile(at("notes.txt"), "trashed");
    const before = await identity("notes.txt");
    await moveToTrash(at("notes.txt"));

    const trashed = await findInTrash(before, {
      folders: Promise.resolve([at(".trash")]),
      from: at("notes.txt"),
      platform: "darwin",
    });
    expect(trashed).toBe(at(".trash/notes.txt 12.00.00"));

    await undo({
      from: at("notes.txt"),
      identity: before,
      kind: "trash",
      trashed,
    });
    expect(await fs.readFile(at("notes.txt"), "utf8")).toBe("trashed");
  });

  it.each([
    ["darwin", "Put “notes.txt” back from the Trash in the Finder."],
    ["win32", "Put “notes.txt” back from the Recycle Bin."],
    ["linux", "Put “notes.txt” back from the Trash."],
  ] as const)(
    "on %s says where to look when the Trash could not be read",
    async (platform, reason) => {
      await expect(
        undoEntry(
          {
            at: 0,
            from: at("notes.txt"),
            id: "entry",
            identity: { dev: 1, ino: "1" },
            kind: "trash",
            trashed: null,
          },
          { platform, trash },
        ),
      ).rejects.toThrow(reason);
    },
  );

  it("names the Recycle Bin on Windows when what was trashed has left it", async () => {
    await expect(
      undoEntry(
        {
          at: 0,
          from: at("notes.txt"),
          id: "entry",
          identity: { dev: 1, ino: "1" },
          kind: "trash",
          trashed: at("$RABC123.txt"),
        },
        { platform: "win32", trash },
      ),
    ).rejects.toThrow("“notes.txt” is no longer in the Recycle Bin.");
  });

  it("finds nothing in a Trash it cannot read", async () => {
    expect(
      await findInTrash(
        { dev: 1, ino: "1" },
        {
          folders: Promise.resolve([at("missing")]),
          from: at("notes.txt"),
          platform: "darwin",
        },
      ),
    ).toBeNull();
  });

  it("looks in the home folder's Trash first at what is named like it", async () => {
    await fs.mkdir(at("home/.Trash"), { recursive: true });
    for (const name of ["agenda.txt", "zebra.txt"]) {
      await fs.writeFile(at(`home/.Trash/${name}`), "someone else's");
    }
    await fs.writeFile(at("notes.txt"), "trashed");
    const before = await identity("notes.txt");
    await fs.rename(at("notes.txt"), at("home/.Trash/notes 12.00.00.txt"));
    const stat = vi.fn(identityOf);

    expect(
      await findInTrash(before, {
        from: at("notes.txt"),
        home: at("home"),
        platform: "darwin",
        stat,
        uid: 501,
      }),
    ).toBe(at("home/.Trash/notes 12.00.00.txt"));
    // The home folder, for its disk, then the one item named like it.
    expect(stat.mock.calls).toEqual([
      [at("home")],
      [at("home/.Trash/notes 12.00.00.txt")],
    ]);
  });
});

describe("an identity", () => {
  it("keeps an inode whole, as its digits", async () => {
    await fs.writeFile(at("notes.txt"), "");
    const { ino } = await fs.lstat(at("notes.txt"), { bigint: true });

    expect((await identity("notes.txt")).ino).toBe(String(ino));
  });

  it("reads an inode the journal kept as a number", () => {
    expect(
      JournalEntrySchema.parse({
        at: 0,
        id: "entry",
        identity: { dev: 1, ino: 42 },
        kind: "new-folder",
        made: "/untitled folder",
      }).identity,
    ).toEqual({ dev: 1, ino: "42" });
  });
});

describe("undoing a move to the freedesktop Trash", () => {
  /** What `gio trash` does: the file into `files/`, where it came from into `info/`. */
  async function gioTrash(name: string) {
    await fs.mkdir(at("data/Trash/files"), { recursive: true });
    await fs.mkdir(at("data/Trash/info"), { recursive: true });
    await fs.rename(at(name), at(`data/Trash/files/${name}`));
    await fs.writeFile(
      at(`data/Trash/info/${name}.trashinfo`),
      `[Trash Info]\nPath=${encodeURI(at(name))}\nDeletionDate=2026-10-13T09:20:26\n`,
    );
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("finds it in the home Trash and puts it back without its record", async () => {
    vi.stubEnv("XDG_DATA_HOME", at("data"));
    await fs.writeFile(at("notes.txt"), "trashed");
    const before = await identity("notes.txt");
    await gioTrash("notes.txt");

    const trashed = await findInTrash(before, {
      from: at("notes.txt"),
      platform: "linux",
    });
    expect(trashed).toBe(at("data/Trash/files/notes.txt"));

    await undoEntry(
      {
        at: 0,
        from: at("notes.txt"),
        id: "entry",
        identity: before,
        kind: "trash",
        trashed,
      },
      { platform: "linux", trash },
    );
    expect(await fs.readFile(at("notes.txt"), "utf8")).toBe("trashed");
    expect(await fs.readdir(at("data/Trash/info"))).toEqual([]);
  });

  it("looks only at the items whose record says they came from there", async () => {
    await fs.writeFile(at("agenda.txt"), "someone else's");
    await gioTrash("agenda.txt");
    await fs.writeFile(at("notes.txt"), "trashed");
    const before = await identity("notes.txt");
    await gioTrash("notes.txt");
    const stat = vi.fn(identityOf);

    expect(
      await findInTrash(before, {
        folders: Promise.resolve([at("data/Trash/files")]),
        from: at("notes.txt"),
        platform: "linux",
        stat,
      }),
    ).toBe(at("data/Trash/files/notes.txt"));
    expect(stat.mock.calls).toEqual([[at("data/Trash/files/notes.txt")]]);
  });

  it("finds it in the Trash at the top of another disk, by the path kept from there", async () => {
    vi.stubEnv("XDG_DATA_HOME", "");
    const disk = at("disk");
    // Everything under `disk` reads as a second disk.
    const stat = async (place: string) => {
      const found = await identityOf(place);
      return found && (place === disk || place.startsWith(`${disk}${path.sep}`))
        ? { ...found, dev: 2 }
        : found;
    };
    await fs.mkdir(at("disk/.Trash-1000/files"), { recursive: true });
    await fs.mkdir(at("disk/.Trash-1000/info"), { recursive: true });
    await fs.writeFile(at("disk/notes.txt"), "trashed");
    const before = await stat(at("disk/notes.txt"));
    if (!before) throw new Error("notes.txt is not there");
    await fs.rename(
      at("disk/notes.txt"),
      at("disk/.Trash-1000/files/notes.txt"),
    );
    await fs.writeFile(
      at("disk/.Trash-1000/info/notes.txt.trashinfo"),
      "[Trash Info]\nPath=notes.txt\nDeletionDate=2026-10-13T09:20:26\n",
    );

    expect(
      await findInTrash(before, {
        from: at("disk/notes.txt"),
        home: at("home"),
        platform: "linux",
        stat,
        uid: 1000,
      }),
    ).toBe(at("disk/.Trash-1000/files/notes.txt"));
  });
});

describe("undoing a move to the Recycle Bin", () => {
  /**
   * A `$I` record as Windows 10 and later write it: when the item was
   * deleted, in 100-nanosecond ticks since 1601, and where it came from, in
   * UTF-16.
   */
  function recycleRecord(from: string, deletedAt = 134_049_000_000_000_000n) {
    const original = Buffer.from(`${from}\0`, "utf16le");
    const header = Buffer.alloc(28);
    header.writeBigUInt64LE(2n, 0);
    header.writeBigUInt64LE(deletedAt, 16);
    header.writeUInt32LE(original.length / 2, 24);
    return Buffer.concat([header, original]);
  }

  /** What the shell does: the item renamed to `$R…` in the bin, its record beside it as `$I…`. */
  async function recycle(name: string, recordedFrom = at(name)) {
    await fs.mkdir(at("bin/S-1-5-21-1001"), { recursive: true });
    await fs.rename(at(name), at("bin/S-1-5-21-1001/$RYSLFOO.txt"));
    await fs.writeFile(
      at("bin/S-1-5-21-1001/$IYSLFOO.txt"),
      recycleRecord(recordedFrom),
    );
  }

  const bins = () =>
    Promise.resolve([at("bin/S-1-5-18"), at("bin/S-1-5-21-1001")]);

  it("finds it by identity and record, and puts it back without the record", async () => {
    await fs.writeFile(at("notes.txt"), "recycled");
    const before = await identity("notes.txt");
    await recycle("notes.txt");

    const trashed = await findInTrash(before, {
      folders: bins(),
      from: at("notes.txt"),
      platform: "win32",
    });
    expect(trashed).toBe(at("bin/S-1-5-21-1001/$RYSLFOO.txt"));

    await undoEntry(
      {
        at: 0,
        from: at("notes.txt"),
        id: "entry",
        identity: before,
        kind: "trash",
        trashed,
      },
      { platform: "win32", trash },
    );
    expect(await fs.readFile(at("notes.txt"), "utf8")).toBe("recycled");
    expect(await fs.readdir(at("bin/S-1-5-21-1001"))).toEqual([]);
  });

  it("passes over an item whose record says it came from somewhere else", async () => {
    // Node reads an NTFS file id as a rounded number, so two files can share
    // an identity; the record is what tells them apart.
    await fs.writeFile(at("notes.txt"), "someone else's");
    const before = await identity("notes.txt");
    await recycle("notes.txt", at("other.txt"));

    expect(
      await findInTrash(before, {
        folders: bins(),
        from: at("notes.txt"),
        platform: "win32",
      }),
    ).toBeNull();
  });

  // Two items that share an identity and came from the same place, as two
  // files Node read the same rounded NTFS id for and both deleted from one
  // path did. A hard link shares an identity for real. Either name can be
  // the one listed first, so both orders are tried.
  it.each([
    ["$RAAAAAA.txt", "$RZZZZZZ.txt"],
    ["$RZZZZZZ.txt", "$RAAAAAA.txt"],
  ])(
    "puts back the newest of several from the same place, %s before %s",
    async (older, newer) => {
      const account = at("bin/S-1-5-21-1001");
      await fs.mkdir(account, { recursive: true });
      await fs.writeFile(at("notes.txt"), "recycled");
      const before = await identity("notes.txt");
      await fs.link(at("notes.txt"), path.join(account, older));
      await fs.rename(at("notes.txt"), path.join(account, newer));
      await fs.writeFile(
        path.join(account, `$I${older.slice(2)}`),
        recycleRecord(at("notes.txt"), 134_049_000_000_000_000n),
      );
      await fs.writeFile(
        path.join(account, `$I${newer.slice(2)}`),
        recycleRecord(at("notes.txt"), 134_049_000_100_000_000n),
      );

      expect(
        await findInTrash(before, {
          folders: bins(),
          from: at("notes.txt"),
          platform: "win32",
        }),
      ).toBe(path.join(account, newer));
    },
  );

  it("refuses an item whose record no longer says it came from there", async () => {
    await fs.writeFile(at("notes.txt"), "someone else's");
    const before = await identity("notes.txt");
    await recycle("notes.txt", at("other.txt"));

    await expect(
      undoEntry(
        {
          at: 0,
          from: at("notes.txt"),
          id: "entry",
          identity: before,
          kind: "trash",
          trashed: at("bin/S-1-5-21-1001/$RYSLFOO.txt"),
        },
        { platform: "win32", trash },
      ),
    ).rejects.toThrow("“notes.txt” is no longer in the Recycle Bin.");
    expect(await listed()).toEqual(["bin"]);
  });
});

describe("the journal", () => {
  it("keeps the newest entries, newest last", () => {
    let entries: JournalEntry[] = [];
    let id = 0;
    const journal = createFileJournal(
      {
        read: () => entries,
        write: (next) => {
          entries = next;
        },
      },
      { makeId: () => String((id += 1)), now: () => id },
    );

    for (let n = 0; n < JOURNAL_LIMIT + 5; n += 1) {
      journal.record({
        identity: { dev: 1, ino: String(n) },
        kind: "new-folder",
        made: `/folder ${n}`,
      });
    }
    expect(entries).toHaveLength(JOURNAL_LIMIT);
    expect(journal.latest()).toMatchObject({
      made: `/folder ${JOURNAL_LIMIT + 4}`,
    });

    // An older entry is found by its id, as a toast's Undo asks for one.
    const older = entries[0];
    expect(journal.byId(older?.id ?? "")).toBe(older);

    journal.remove(journal.latest()?.id ?? "");
    expect(journal.latest()).toMatchObject({
      made: `/folder ${JOURNAL_LIMIT + 3}`,
    });
  });
});

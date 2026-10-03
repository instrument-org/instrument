import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createFileJournal,
  findInTrash,
  identityOf,
  JOURNAL_LIMIT,
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
    await fs.rm(at("plans.txt"));
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

    const trashed = await findInTrash(before, Promise.resolve([at(".trash")]));
    expect(trashed).toBe(at(".trash/notes.txt 12.00.00"));

    await undo({
      from: at("notes.txt"),
      identity: before,
      kind: "trash",
      trashed,
    });
    expect(await fs.readFile(at("notes.txt"), "utf8")).toBe("trashed");
  });

  it("says where to look when the Trash could not be read", async () => {
    await expect(
      undo({
        from: at("notes.txt"),
        identity: { dev: 1, ino: 1 },
        kind: "trash",
        trashed: null,
      }),
    ).rejects.toThrow("back from the Trash in the Finder");
  });

  it("finds nothing in a Trash it cannot read", async () => {
    expect(
      await findInTrash({ dev: 1, ino: 1 }, Promise.resolve([at("missing")])),
    ).toBeNull();
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
        identity: { dev: 1, ino: n },
        kind: "new-folder",
        made: `/folder ${n}`,
      });
    }
    expect(entries).toHaveLength(JOURNAL_LIMIT);
    expect(journal.latest()).toMatchObject({
      made: `/folder ${JOURNAL_LIMIT + 4}`,
    });

    journal.remove(journal.latest()?.id ?? "");
    expect(journal.latest()).toMatchObject({
      made: `/folder ${JOURNAL_LIMIT + 3}`,
    });
  });
});

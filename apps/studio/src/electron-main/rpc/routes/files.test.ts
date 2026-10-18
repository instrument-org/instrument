import { call, os } from "@orpc/server";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  identityOf,
  type JournalEntry,
} from "@/electron-main/lib/file-journal";
import { getFileJournal } from "@/electron-main/stores/machine/file-journal";

import { type InitialRPCContext } from "../context";
import { files } from "./files";

vi.mock("electron", () => ({ shell: {} }));
vi.mock("@/electron-main/rpc/base", () => ({ base: os }));
// A Finder alias resolves through the Mac module; here every alias leads to
// whatever `aliasTargets` names for it.
const aliasTargets = new Map<string, string>();
vi.mock("@/electron-main/lib/mac-native", () => ({
  resolveAlias: (filePath: string) =>
    Promise.resolve(aliasTargets.get(filePath)),
}));
// The app's own data, which `refused-files.ts` rules on, stood in for by
// whatever folders `closedFolders` names.
const closedFolders: string[] = [];
const isClosed = (filePath: string) =>
  closedFolders.some(
    (folder) => filePath === folder || filePath.startsWith(`${folder}/`),
  );
vi.mock("@/electron-main/lib/refused-files", () => ({
  isRefusedByName: (filePath: string) => isClosed(filePath),
  isRefusedFile: (filePath: string) => Promise.resolve(isClosed(filePath)),
}));
// The journal kept in memory rather than in the machine's store.
vi.mock("@/electron-main/stores/machine/file-journal", async () => {
  const { createFileJournal } =
    await import("@/electron-main/lib/file-journal");
  let entries: JournalEntry[] = [];
  const journal = createFileJournal({
    read: () => entries,
    write: (next) => {
      entries = next;
    },
  });
  return { getFileJournal: () => journal };
});

// Neither route reads its context, and the base it is built on is mocked
// out, so an empty one stands in for the window's.
const options = { context: {} as InitialRPCContext };

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(tmpdir(), "files-route-"));
});
afterEach(async () => {
  closedFolders.length = 0;
  await fs.rm(dir, { force: true, recursive: true });
});

it("neither reads nor writes the app's own data", async () => {
  const keys = path.join(dir, "keys");
  const file = path.join(keys, "session.json");
  await fs.mkdir(keys);
  await fs.writeFile(file, "secret");
  closedFolders.push(keys);

  await expect(call(files.read, { path: file }, options)).rejects.toMatchObject(
    { code: "FORBIDDEN" },
  );
  await expect(
    call(files.write, { content: "replaced", path: file }, options),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await fs.readFile(file, "utf8")).toBe("secret");
});

it("lets only one of two writers holding the same version write", async () => {
  const file = path.join(dir, "doc.txt");
  await fs.writeFile(file, "base");
  const { version } = await call(files.read, { path: file }, options);

  const results = await Promise.all(
    ["first edit", "second edit"].map((content) =>
      call(files.write, { baseVersion: version, content, path: file }, options),
    ),
  );

  // Either may win; the loser gets the winner's text back to merge.
  const won = results.findIndex((r) => r.ok);
  const lost = results[1 - won];
  const winner = ["first edit", "second edit"][won];
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(lost).toMatchObject({ content: winner, ok: false });
  expect(await fs.readFile(file, "utf8")).toBe(winner);
});

// "café" in Windows-1252: the é is one byte, 0xE9, which is not UTF-8.
const LATIN_1 = Buffer.from([0x63, 0x61, 0x66, 0xe9]);

it("reads a file that is not UTF-8 as not editable and refuses to write over it", async () => {
  const file = path.join(dir, "notes.md");
  await fs.writeFile(file, LATIN_1);
  const read = await call(files.read, { path: file }, options);
  expect(read).toMatchObject({ content: "caf\uFFFD", utf8: false });

  await expect(
    call(
      files.write,
      { baseVersion: read.version, content: "caf\uFFFD!", path: file },
      options,
    ),
  ).rejects.toMatchObject({ code: "NOT_UTF8" });
  await expect(
    call(files.write, { content: "replaced", path: file }, options),
  ).rejects.toMatchObject({ code: "NOT_UTF8" });
  expect(await fs.readFile(file)).toEqual(LATIN_1);
});

it("keeps a UTF-8 file's byte-order mark in what it reads", async () => {
  const file = path.join(dir, "bom.txt");
  await fs.writeFile(file, "\uFEFFhello");
  const read = await call(files.read, { path: file }, options);
  expect(read).toMatchObject({ content: "\uFEFFhello", utf8: true });
  const written = await call(
    files.write,
    { baseVersion: read.version, content: "\uFEFFhello!", path: file },
    options,
  );
  expect(written.ok).toBe(true);
});

it("creates a file that is not there yet", async () => {
  const file = path.join(dir, "new.md");
  const written = await call(
    files.write,
    { content: "new", path: file },
    options,
  );
  expect(written.ok).toBe(true);
  expect(await fs.readFile(file, "utf8")).toBe("new");
});

// An alias is followed the way a symbolic link is, so a text editor opened
// on one reads and writes the file it leads to, not the bookmark.
it("reads and writes the file a Finder alias leads to", async () => {
  const target = path.join(dir, "notes.md");
  const alias = path.join(dir, "notes.md alias");
  await fs.writeFile(target, "# notes");
  await fs.writeFile(alias, "book\0\0\0\0mark");
  aliasTargets.set(alias, target);

  const read = await call(files.read, { path: alias }, options);
  expect(read).toMatchObject({ content: "# notes", utf8: true });
  await call(
    files.write,
    { baseVersion: read.version, content: "# notes!", path: alias },
    options,
  );

  expect(await fs.readFile(target, "utf8")).toBe("# notes!");
  expect(await fs.readFile(alias, "utf8")).toBe("book\0\0\0\0mark");
});

// The toast that offered an Undo has to go once its entry is taken back by
// any route, ⌘Z included, so the undo says which entry it was.
it("names the journal entry an undo took back", async () => {
  const made = await call(files.newFolder, { parent: dir }, options);

  const undone = await call(files.undo, undefined, options);

  expect(undone).toMatchObject({
    journalId: expect.any(String),
    kind: "new-folder",
  });
  await expect(fs.stat(made.path)).rejects.toThrow();
  await expect(
    call(files.undo, { journalId: undone.journalId }, options),
  ).rejects.toThrow("There is nothing to undo");
});

/** Journals a move of `notes.txt` in `dir` to the Trash, landing wherever `trashed` puts it. */
async function journalTrash(
  trashed: (notes: string) => Promise<null | string>,
) {
  const notes = path.join(dir, "notes.txt");
  await fs.writeFile(notes, "notes");
  const identity = await identityOf(notes);
  if (!identity) throw new Error("notes.txt is not there");
  getFileJournal().record({
    from: notes,
    identity,
    kind: "trash",
    trashed: await trashed(notes),
  });
  return notes;
}

// Without Full Disk Access a Mac never lets the app find what it trashed, so
// the move can never be undone here: it says where to look once, and the
// next undo takes back the action before it.
it("drops a move to the Trash it can never put back once it has said why", async () => {
  const made = await call(files.newFolder, { parent: dir }, options);
  await journalTrash(async (notes) => {
    await fs.rm(notes);
    return null;
  });

  await expect(call(files.undo, undefined, options)).rejects.toThrow(
    "Instrument couldn't find “notes.txt” in the",
  );
  expect(await call(files.undo, undefined, options)).toMatchObject({
    kind: "new-folder",
  });
  await expect(fs.stat(made.path)).rejects.toThrow();
});

it("passes over a move to the Trash put back by hand to the action before it", async () => {
  const made = await call(files.newFolder, { parent: dir }, options);
  const notes = await journalTrash(async () =>
    path.join(dir, "trash", "notes.txt"),
  );

  expect(await call(files.undo, undefined, options)).toMatchObject({
    kind: "new-folder",
  });
  await expect(fs.stat(made.path)).rejects.toThrow();
  expect(await fs.readFile(notes, "utf8")).toBe("notes");
  await expect(call(files.undo, undefined, options)).rejects.toThrow(
    "There is nothing to undo",
  );
});

it("keeps a move to the Trash whose name is taken until the way is clear", async () => {
  await fs.mkdir(path.join(dir, "trash"));
  const notes = await journalTrash(async (from) => {
    const trashed = path.join(dir, "trash", "notes.txt");
    await fs.rename(from, trashed);
    await fs.writeFile(from, "someone else's");
    return trashed;
  });

  for (const attempt of [1, 2]) {
    await expect(
      call(files.undo, undefined, options),
      `attempt ${attempt}`,
    ).rejects.toThrow("Something named “notes.txt” is already there.");
  }
  await fs.rm(notes);
  expect(await call(files.undo, undefined, options)).toMatchObject({
    kind: "trash",
    path: notes,
  });
  expect(await fs.readFile(notes, "utf8")).toBe("notes");
});

it("links a picture below the folder in place and copies one from elsewhere beside it", async () => {
  const folder = path.join(dir, "notes");
  await fs.mkdir(path.join(folder, "shots"), { recursive: true });
  const inside = path.join(folder, "shots", "a.png");
  const outside = path.join(dir, "a.png");
  await fs.writeFile(inside, "inside");
  await fs.writeFile(outside, "outside");
  await fs.writeFile(path.join(folder, "a.png"), "taken");

  const linked = await call(files.addFile, { folder, from: inside }, options);
  const copied = await call(files.addFile, { folder, from: outside }, options);
  const pasted = await call(
    files.addFile,
    { content: Buffer.from("bytes").toString("base64"), folder, name: "a.png" },
    options,
  );

  expect(
    [linked, copied, pasted].map((result) => path.relative(dir, result.path)),
  ).toEqual(["notes/shots/a.png", "notes/a 2.png", "notes/a 3.png"]);
  expect(await fs.readFile(copied.path, "utf8")).toBe("outside");
  expect(await fs.readFile(pasted.path, "utf8")).toBe("bytes");
});

import { call, os, ORPCError } from "@orpc/server";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fileJournal, identityOf } from "@/electron-main/lib/file-journal";

import { type InitialRPCContext } from "../context";
import { files } from "./files";

// The system clipboard as what was last written to it and what it holds:
// one item, by its formats. `pasteboard` is the Mac module's list of the
// files on it, undefined where there is no module.
const clipboardState = vi.hoisted(() => ({
  holds: {} as Record<string, string>,
  pasteboard: undefined as string[] | undefined,
  written: [] as Record<string, string>[],
}));
vi.mock("electron", () => ({
  ClipboardItem: class {
    constructor(formats: Record<string, string>) {
      clipboardState.written.push(formats);
    }
  },
  clipboard: {
    read: () =>
      Promise.resolve([
        {
          getType: (type: string) =>
            Promise.resolve(new Blob([clipboardState.holds[type] ?? ""])),
          types: Object.keys(clipboardState.holds),
        },
      ]),
    write: () => Promise.resolve(),
  },
  shell: {},
}));
vi.mock("@/electron-main/rpc/base", () => ({ base: os }));
// What the app keeps by path and carries along with a move: here nothing.
vi.mock("@/electron-main/browser-view/history-store", () => ({
  getHistoryStore: () => ({ moveFiles: () => undefined }),
}));
// The record of what placing leaves under its own names, kept in memory.
vi.mock("@/electron-main/stores/machine/state", () => {
  const kept = new Map<string, unknown>();
  return {
    getMachineState: () => ({
      get: (key: string) => kept.get(key),
      set: (key: string, value: unknown) => kept.set(key, value),
    }),
  };
});
vi.mock("@/electron-main/stores/machine/preferences", () => ({
  getMachinePreferences: () => ({
    get: () => ({ pinned: [], unpinned: [] }),
    set: () => undefined,
  }),
}));
// A Finder alias resolves through the Mac module; here every alias leads to
// whatever `aliasTargets` names for it.
const aliasTargets = new Map<string, string>();
vi.mock("@/electron-main/lib/mac-native", () => ({
  caseSensitivity: () => Promise.resolve(undefined),
  finderEntries: () => Promise.resolve([]),
  renameExclusive: () => Promise.resolve(false),
  pasteboardFiles: () => Promise.resolve(clipboardState.pasteboard),
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

// What Defender's log says kept the app out of a folder, which a test sets.
const protection = vi.hoisted(() => ({
  block: undefined as undefined | { folder: string; programs: string[] },
}));
vi.mock(
  import("@instrument-org/workspace/electron"),
  async (importOriginal) => ({
    ...(await importOriginal()),
    confirmedBlock: () => Promise.resolve(protection.block),
  }),
);

// The home folder, a folder of the test's own, so a refusal that failed
// would change that one and never the developer's.
const fakeHome = vi.hoisted(() => ({ path: "/nowhere/home" }));
vi.mock("node:os", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:os")>();
  const homedir = () => fakeHome.path;
  return { ...real, default: { ...real, homedir }, homedir };
});

// The folder the workspace is kept in, which a test sets.
const workspace = vi.hoisted(() => ({ folder: "/nowhere/workspace" }));
vi.mock("@/electron-main/lib/get-workspace-folder", () => ({
  getWorkspaceFolder: () => workspace.folder,
}));

// Neither route reads its context, and the base it is built on is mocked
// out, so an empty one stands in for the window's.
const options = { context: {} as InitialRPCContext };

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(tmpdir(), "files-route-"));
});
afterEach(async () => {
  closedFolders.length = 0;
  workspace.folder = "/nowhere/workspace";
  fakeHome.path = "/nowhere/home";
  protection.block = undefined;
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

it("leaves the home folder and the workspace's folder where they are", async () => {
  const home = path.join(dir, "Users", "mac-user");
  fakeHome.path = home;
  await fs.mkdir(path.join(home, "Documents"), { recursive: true });
  // The home folder's Documents reached through a link to the folder above it.
  await fs.symlink(path.join(dir, "Users"), path.join(dir, "disk"));
  const linked = path.join(dir, "disk", "mac-user", "Documents");
  const around = path.join(dir, "projects");
  workspace.folder = path.join(around, "Instrument");
  await fs.mkdir(workspace.folder, { recursive: true });
  const into = path.join(dir, "elsewhere");
  await fs.mkdir(into);

  // Each made only when the one before it is refused, so a refusal that
  // failed leaves the rest unsent.
  for (const attempt of [
    () => call(files.rename, { name: "Gone", path: home }, options),
    () => call(files.duplicate, { path: home }, options),
    () => call(files.trash, { path: `${home}/Desktop/../Documents/` }, options),
    () => call(files.rename, { name: "Gone", path: linked }, options),
    () =>
      call(
        files.copyInto,
        {
          folder: path.join(dir, "disk", "mac-user"),
          paths: [path.join(dir, "elsewhere", "Documents")],
          resolutions: {
            [path.join(dir, "elsewhere", "Documents")]: "replace",
          },
        },
        options,
      ),
    () => call(files.rename, { name: "Moved", path: around }, options),
    () => call(files.moveInto, { folder: into, paths: [around] }, options),
    () => call(files.trash, { path: workspace.folder }, options),
  ]) {
    await expect(attempt()).rejects.toMatchObject({ code: "PROTECTED" });
  }
  expect(await fs.readdir(dir)).toEqual([
    "Users",
    "disk",
    "elsewhere",
    "projects",
  ]);
  expect(await fs.readdir(home)).toEqual(["Documents"]);
  expect(await fs.readdir(around)).toEqual(["Instrument"]);
});

it("leaves the workspace's key folders and records where they are, and what is in them editable", async () => {
  const real = path.join(dir, "Instrument");
  for (const folder of [
    "Topics/Travel",
    "Chats",
    ".instrument",
    "Projects/Skills",
  ]) {
    await fs.mkdir(path.join(real, folder), { recursive: true });
  }
  // The workspace named through a link, and Topics reached through another.
  await fs.symlink(real, path.join(dir, "linked"));
  workspace.folder = path.join(dir, "linked");
  const elsewhere = path.join(dir, "elsewhere");
  await fs.mkdir(elsewhere);

  const refusal = (attempt: Promise<unknown>) =>
    attempt.then(
      () => "done",
      (error: unknown) =>
        error instanceof ORPCError
          ? `${String(error.code)}: ${error.message}`
          : String(error),
    );
  expect(
    await Promise.all([
      refusal(
        call(
          files.rename,
          { name: "Subjects", path: path.join(real, "Topics") },
          options,
        ),
      ),
      refusal(
        call(files.trash, { path: path.join(dir, "linked", "Chats") }, options),
      ),
      refusal(
        call(
          files.duplicate,
          { path: path.join(real, ".instrument") },
          options,
        ),
      ),
      refusal(
        call(
          files.moveInto,
          { folder: elsewhere, paths: [path.join(real, "Topics")] },
          options,
        ),
      ),
    ]),
  ).toMatchInlineSnapshot(`
    [
      "PROTECTED: Instrument keeps your topics in this folder, so it stays put.",
      "PROTECTED: Instrument keeps your chats in this folder, so it stays put.",
      "PROTECTED: Instrument keeps its own records in this folder, so it stays put.",
      "PROTECTED: Instrument keeps your topics in this folder, so it stays put.",
    ]
  `);
  expect((await fs.readdir(real)).toSorted()).toEqual([
    ".instrument",
    "Chats",
    "Projects",
    "Topics",
  ]);

  // Inside a key folder, and a key folder's name deeper down, are the person's.
  await call(
    files.rename,
    { name: "Trips", path: path.join(real, "Topics", "Travel") },
    options,
  );
  await call(
    files.rename,
    { name: "Tools", path: path.join(real, "Projects", "Skills") },
    options,
  );
  expect(await fs.readdir(path.join(real, "Topics"))).toEqual(["Trips"]);
  expect(await fs.readdir(path.join(real, "Projects"))).toEqual(["Tools"]);
  // Taken back, so the journal the tests share is as this one found it.
  await call(files.undo, undefined, options);
  await call(files.undo, undefined, options);
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
  fileJournal.record({
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

it("copies files to the clipboard with their names as text beside them", async () => {
  clipboardState.written.length = 0;
  await call(
    files.copyToClipboard,
    { paths: ["/Users/sam/notes.txt", "/Users/sam/pics"] },
    options,
  );

  const [formats] = clipboardState.written;
  expect(formats?.["text/plain"]).toBe("notes.txt\npics");
  expect(
    Object.keys(formats ?? {}).filter((type) => type !== "text/plain"),
  ).toEqual(
    process.platform === "darwin"
      ? ['electron application/osclipboard;format="NSFilenamesPboardType"']
      : expect.arrayContaining(["text/uri-list"]),
  );
});

it.each([
  ["the Mac's files", ["/a.txt"], { "text/plain": "a.txt" }, true],
  ["text alone, on the Mac", [], { "text/plain": "a.txt" }, false],
  [
    "a URI list beside text, elsewhere",
    undefined,
    { "text/plain": "a.txt", "text/uri-list": "file:///a.txt" },
    true,
  ],
  ["text alone, elsewhere", undefined, { "text/plain": "a.txt" }, false],
] as const)(
  "offers Paste for %s",
  async (_case, pasteboard, holds, hasFiles) => {
    clipboardState.pasteboard = pasteboard ? [...pasteboard] : undefined;
    clipboardState.holds = holds;
    expect(await call(files.clipboardHasFiles, undefined, options)).toEqual({
      hasFiles,
    });
  },
);

// Placing things into a folder is planned and carried out by
// `finder-placing`, whose own tests cover every case and every failure;
// these cover the routes over it, with no Trash involved.

/** A folder `from` holding `notes.txt` and `pics/a.jpg`, and an empty folder `into` beside it. */
async function placeFixture() {
  const from = path.join(dir, "from");
  const into = path.join(dir, "into");
  await fs.mkdir(path.join(from, "pics"), { recursive: true });
  await fs.mkdir(into);
  await fs.writeFile(path.join(from, "notes.txt"), "notes");
  await fs.writeFile(path.join(from, "pics", "a.jpg"), "a");
  return {
    from,
    into,
    sources: [path.join(from, "notes.txt"), path.join(from, "pics")],
  };
}

it("finds the names a drop would land on, but not one going back into its own folder", async () => {
  const { from, into, sources } = await placeFixture();
  await fs.mkdir(path.join(into, "pics"));

  const { clashes } = await call(
    files.clashes,
    { folder: into, op: "move", paths: sources },
    options,
  );
  expect(
    clashes.map((clash) => [
      clash.name,
      clash.kind,
      clash.with.by,
      clash.with.kind,
    ]),
  ).toEqual([["pics", "folder", "entry", "folder"]]);
  expect(
    await call(
      files.clashes,
      { folder: from, op: "copy", paths: sources },
      options,
    ),
  ).toEqual({ clashes: [] });
});

it("copies in, keeping both where answered, and one undo takes all of it back", async () => {
  const { shell } = await import("electron");
  shell.trashItem = (at: string) => fs.rm(at, { recursive: true });
  const { into, sources } = await placeFixture();
  await fs.writeFile(path.join(into, "notes.txt"), "already here");
  const [notes] = sources;
  if (!notes) throw new Error("no sources");

  const copied = await call(
    files.copyInto,
    { folder: into, paths: sources, resolutions: { [notes]: "keepBoth" } },
    options,
  );

  expect(copied.placed.map((each) => path.basename(each.path))).toEqual([
    "notes 2.txt",
    "pics",
  ]);
  expect(await call(files.undo, undefined, options)).toMatchObject({
    kind: "copy",
  });
  expect(await fs.readdir(into)).toEqual(["notes.txt"]);
});

it("refuses a clash it has no answer for, touching nothing", async () => {
  const { into, sources } = await placeFixture();
  await fs.writeFile(path.join(into, "notes.txt"), "already here");

  await expect(
    call(files.copyInto, { folder: into, paths: sources }, options),
  ).rejects.toMatchObject({ code: "CANNOT_PLACE" });
  expect(await fs.readdir(into)).toEqual(["notes.txt"]);
});

it("moves the Finder's own rows on one disk, and one undo puts them back", async () => {
  const { from, into, sources } = await placeFixture();

  await call(files.moveInto, { folder: into, paths: sources }, options);
  expect(await fs.readdir(from)).toEqual([]);

  expect(await call(files.undo, undefined, options)).toMatchObject({
    kind: "move",
    path: sources[0],
  });
  expect((await fs.readdir(from)).toSorted()).toEqual(["notes.txt", "pics"]);
  expect(await fs.readdir(into)).toEqual([]);
});

it("refuses to undo a move once something it moved has changed, and puts nothing back", async () => {
  const { from, into, sources } = await placeFixture();
  await call(files.moveInto, { folder: into, paths: sources }, options);
  await fs.rename(path.join(into, "pics"), path.join(into, "photos"));

  await expect(call(files.undo, undefined, options)).rejects.toThrow(
    "“pics” has been moved or replaced since it was moved.",
  );
  expect(await fs.readdir(from)).toEqual([]);
});

it("leaves a row dropped on its own folder where it is, and refuses a folder into itself", async () => {
  const { from, sources } = await placeFixture();

  expect(
    await call(files.moveInto, { folder: from, paths: sources }, options),
  ).toEqual({
    failure: null,
    journalId: null,
    placed: [],
    protection: null,
    skipped: [],
    trashed: [],
  });
  await expect(
    call(
      files.moveInto,
      { folder: path.join(from, "pics"), paths: [path.join(from, "pics")] },
      options,
    ),
  ).rejects.toMatchObject({ code: "CANNOT_PLACE" });
});

it.each([
  ["Windows' ransomware protection blocked it", true],
  ["it failed for any other reason", false],
])(
  "says a write failed because %s only when Defender's log names the block",
  async (_name, blocked) => {
    // Under a file, so making the folder fails however the disk is set up.
    const file = path.join(dir, "file.txt");
    await fs.writeFile(file, "");
    const block = {
      folder: path.join(dir, "Documents"),
      programs: [path.join(dir, "Instrument.exe")],
    };
    protection.block = blocked ? block : undefined;

    await expect(
      call(files.newFolder, { parent: file }, options),
    ).rejects.toMatchObject(
      blocked
        ? { code: "WINDOWS_PROTECTION", data: block }
        : { code: "CANNOT_WRITE" },
    );
  },
);

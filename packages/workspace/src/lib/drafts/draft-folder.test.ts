import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type DraftFile, renderDraftFile } from "./draft-file";
import {
  type DraftOnDisk,
  draftsFolderDir,
  ensureDraftFolder,
  makeDraftFolder,
  findDraft,
  draftFolderItems,
  draftFolderItemAt,
  namedByOtherDrafts,
  trashLeftInDraft,
  ownsDraftFolder,
  readDrafts,
  removeDraft,
  writeDraftFile,
} from "./draft-folder";

/** The zone the days in the folder names are read in, fixed for the tests. */
const ZONE = "America/New_York";

let rootDir: string;

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "drafts-folder-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(rootDir, { force: true, recursive: true });
});

function draft(more: Partial<DraftFile> = {}): DraftFile {
  const created = new Date("2026-10-14T18:22:04.000Z");
  return {
    created,
    id: "d1",
    updated: created,
    words: "Find a quiet dishwasher.",
    ...more,
  };
}

/** Where a draft ended up, as a path under the workspace. */
// Spelled with "/" between the names, so the snapshots below read the same
// whatever this computer writes between the names of its own.
function at({ file }: DraftOnDisk): string {
  return path.relative(rootDir, file).split(path.sep).join("/");
}

describe("the drafts folder", () => {
  it("keeps a key another writer left, through a save that knows nothing about it", () => {
    const file = path.join(rootDir, "Drafts", "2026-10-14", "DRAFT.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      [
        "---",
        'id: "d1"',
        "created: 2026-10-14T18:22:04.000Z",
        "voice: true",
        "---",
        "",
        "Find a quiet dishwasher.",
        "",
      ].join("\n"),
      "utf8",
    );

    // The window hands over this build's keys and no others, the way it
    // would after the person typed another word.
    writeDraftFile(
      file,
      draft({ words: "Find a quiet dishwasher under 900." }),
    );

    expect(fs.readFileSync(file, "utf8")).toMatchInlineSnapshot(`
      "---
      id: "d1"
      created: 2026-10-14T18:22:04Z
      updated: 2026-10-14T18:22:04Z
      voice: true
      ---

      Find a quiet dishwasher under 900.
      "
    `);
  });

  it("names a draft's folder for the day it was started", () => {
    expect(
      at(makeDraftFolder({ draft: draft(), rootDir, timeZone: ZONE })),
    ).toMatchInlineSnapshot(`"Drafts/2026-10-14/DRAFT.md"`);
  });

  it("reads the day in the writing device's own zone", () => {
    // Late evening in New York is the next day in London.
    expect(
      at(
        makeDraftFolder({
          draft: draft(),
          rootDir,
          timeZone: "Europe/London",
        }),
      ),
    ).toMatchInlineSnapshot(`"Drafts/2026-10-14/DRAFT.md"`);
    expect(
      at(
        makeDraftFolder({
          draft: draft({
            created: new Date("2026-10-15T01:30:00.000Z"),
            id: "d2",
          }),
          rootDir,
          timeZone: "Europe/London",
        }),
      ),
    ).toMatchInlineSnapshot(`"Drafts/2026-10-15/DRAFT.md"`);
  });

  it("numbers a second draft started the same day", () => {
    makeDraftFolder({ draft: draft(), rootDir, timeZone: ZONE });
    makeDraftFolder({ draft: draft({ id: "d2" }), rootDir, timeZone: ZONE });
    makeDraftFolder({ draft: draft({ id: "d3" }), rootDir, timeZone: ZONE });
    expect(fs.readdirSync(draftsFolderDir(rootDir)).toSorted())
      .toMatchInlineSnapshot(`
      [
        "2026-10-14",
        "2026-10-14 2",
        "2026-10-14 3",
      ]
    `);
  });

  it("answers with the folder it made when the same draft is asked for again", async () => {
    const first = await ensureDraftFolder({
      draft: draft(),
      rootDir,
      timeZone: ZONE,
    });
    const again = await ensureDraftFolder({
      draft: draft({ words: "more" }),
      rootDir,
      timeZone: ZONE,
    });
    expect(again.dir).toBe(first.dir);
    expect(fs.readdirSync(draftsFolderDir(rootDir))).toEqual(["2026-10-14"]);
  });

  it("may be named for its words, where nobody is typing into it", () => {
    expect(
      at(
        makeDraftFolder({
          draft: draft(),
          named: 'Tidy up: the "big" one/two',
          rootDir,
          timeZone: ZONE,
        }),
      ),
    ).toMatchInlineSnapshot(`"Drafts/Tidy up the big one two/DRAFT.md"`);
  });

  it("holds the draft whatever its folder is called", async () => {
    const made = makeDraftFolder({ draft: draft(), rootDir, timeZone: ZONE });
    const moved = path.join(draftsFolderDir(rootDir), "my dishwasher notes");
    fs.renameSync(made.dir, moved);
    expect((await readDrafts(rootDir)).map((entry) => entry.draft.id)).toEqual([
      "d1",
    ]);
    expect((await findDraft(rootDir, "d1"))?.dir).toBe(moved);
  });

  it("reads two drafts in one folder as two", async () => {
    const { dir } = makeDraftFolder({
      draft: draft(),
      rootDir,
      timeZone: ZONE,
    });
    // What two devices offline on the same day leave, and what a sync
    // engine's conflict copy of one draft looks like.
    writeDraftFile(path.join(dir, "DRAFT 2.md"), draft({ id: "d2" }));
    fs.writeFileSync(
      path.join(dir, "DRAFT.sync-conflict-20261014-dev_B.md"),
      renderDraftFile(draft({ words: "the other copy" })),
    );
    expect(
      (await readDrafts(rootDir)).map((entry) => [
        path.basename(entry.file),
        entry.draft.id,
      ]),
    ).toMatchInlineSnapshot(`
      [
        [
          "DRAFT.md",
          "d1",
        ],
        [
          "DRAFT.sync-conflict-20261014-dev_B.md",
          "d1",
        ],
        [
          "DRAFT 2.md",
          "d2",
        ],
      ]
    `);
  });

  it("passes over a folder holding no draft, and a file that is not one", async () => {
    const stray = path.join(draftsFolderDir(rootDir), "Notes");
    fs.mkdirSync(stray, { recursive: true });
    fs.writeFileSync(path.join(stray, "DRAFT.md"), "---\nid: [1, 2\n---\n");
    fs.writeFileSync(path.join(stray, "thoughts.md"), "Mine.\n");
    expect(await readDrafts(rootDir)).toEqual([]);
  });

  it("gives a draft written by hand an id, and writes it into the file", async () => {
    const file = path.join(draftsFolderDir(rootDir), "Mine", "DRAFT.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "---\ntopic: tpc_01KF\n---\nCall the plumber.\n");

    const [read] = await readDrafts(rootDir);

    expect(read?.draft).toMatchObject({
      topic: "tpc_01KF",
      words: "Call the plumber.",
    });
    expect(fs.readFileSync(file, "utf8")).toContain(
      `id: ${JSON.stringify(read?.draft.id)}`,
    );
    expect((await readDrafts(rootDir)).map((entry) => entry.draft.id)).toEqual([
      read?.draft.id,
    ]);
  });

  it("hands back what the folder still has, for the Trash, and deletes none of it", () => {
    const made = makeDraftFolder({ draft: draft(), rootDir, timeZone: ZONE });
    fs.writeFileSync(path.join(made.dir, "dropped.pdf"), "the only copy");
    fs.mkdirSync(path.join(made.dir, "Photos"));
    fs.writeFileSync(path.join(made.dir, ".DS_Store"), "");
    const left = removeDraft(made);
    expect(
      left.map((item) => `${item.kind}:${path.basename(item.path)}`),
    ).toEqual(["folder:Photos", "file:dropped.pdf"]);
    expect(fs.readdirSync(made.dir).toSorted()).toEqual([
      ".DS_Store",
      "Photos",
      "dropped.pdf",
    ]);
  });

  it.each([[[".DS_Store"]], [["._DRAFT.md", "desktop.ini", "Thumbs.db"]]])(
    "takes the folder away when only a file manager's records %j are left",
    (records) => {
      const made = makeDraftFolder({
        draft: draft(),
        rootDir,
        timeZone: ZONE,
      });
      for (const name of records) {
        fs.writeFileSync(path.join(made.dir, name), "");
      }
      expect(removeDraft(made)).toEqual([]);
      expect(fs.existsSync(made.dir)).toBe(false);
    },
  );

  it("keeps the folder while a download is still arriving in it", () => {
    const made = makeDraftFolder({ draft: draft(), rootDir, timeZone: ZONE });
    fs.writeFileSync(path.join(made.dir, ".DS_Store"), "");
    fs.writeFileSync(path.join(made.dir, "report.pdf.crdownload"), "half");
    removeDraft(made);
    expect(fs.readdirSync(made.dir).toSorted()).toEqual([
      ".DS_Store",
      "report.pdf.crdownload",
    ]);
  });

  it("moves what was left to the Trash and takes the folder after it, keeping what will not move", async () => {
    const made = makeDraftFolder({ draft: draft(), rootDir, timeZone: ZONE });
    fs.writeFileSync(path.join(made.dir, "dropped.pdf"), "the only copy");
    fs.writeFileSync(path.join(made.dir, "stuck.pdf"), "locked");
    const trashDir = fs.mkdtempSync(path.join(rootDir, "trash-"));
    const kept = await trashLeftInDraft({
      dir: made.dir,
      left: removeDraft(made),
      moveToTrash: (target) =>
        path.basename(target) === "stuck.pdf"
          ? Promise.reject(new Error("locked"))
          : Promise.resolve(
              fs.renameSync(target, path.join(trashDir, path.basename(target))),
            ),
    });
    expect(kept.map((entry) => path.basename(entry.path))).toEqual([
      "stuck.pdf",
    ]);
    expect(fs.readdirSync(trashDir)).toEqual(["dropped.pdf"]);
    expect(fs.readdirSync(made.dir)).toEqual(["stuck.pdf"]);
  });

  it("leaves a folder of the person's that a draft names above its own", () => {
    const victim = path.join(rootDir, "valuable-work");
    fs.mkdirSync(victim, { recursive: true });
    fs.writeFileSync(path.join(victim, "report.txt"), "the person's");
    const made = makeDraftFolder({ draft: draft(), rootDir, timeZone: ZONE });
    const with_ = {
      ...made.draft,
      context: [path.join("..", "..", "valuable-work")],
    };
    writeDraftFile(made.file, with_);

    removeDraft({ ...made, draft: with_ });

    expect(fs.existsSync(path.join(victim, "report.txt"))).toBe(true);
    expect(fs.existsSync(made.file)).toBe(false);
  });

  // "." is the draft's own folder and ".." the folder of every draft
  // started that day, neither of which is a file the draft pasted.
  it.each([".", ".."])(
    "leaves another draft alone where one names %s",
    (named) => {
      const made = makeDraftFolder({
        draft: draft(),
        rootDir,
        timeZone: ZONE,
      });
      const other = path.join(made.dir, "DRAFT 2.md");
      writeDraftFile(other, draft({ id: "d2" }));
      const with_ = { ...made.draft, context: [named] };
      writeDraftFile(made.file, with_);

      removeDraft({ ...made, draft: with_ });

      expect(fs.existsSync(other)).toBe(true);
    },
  );

  it("takes only the link to a folder outside, never what it leads to", () => {
    const victim = path.join(rootDir, "valuable-work");
    fs.mkdirSync(victim, { recursive: true });
    fs.writeFileSync(path.join(victim, "report.txt"), "the person's");
    const made = makeDraftFolder({ draft: draft(), rootDir, timeZone: ZONE });
    fs.symlinkSync(victim, path.join(made.dir, "out"));
    const with_ = {
      ...made.draft,
      context: [path.join("out", "report.txt")],
    };
    writeDraftFile(made.file, with_);

    removeDraft({ ...made, draft: with_ });

    expect(fs.existsSync(path.join(victim, "report.txt"))).toBe(true);
  });

  it("keeps a file another draft in a shared folder still names", () => {
    const made = makeDraftFolder({ draft: draft(), rootDir, timeZone: ZONE });
    const pasted = path.join(made.dir, "pasted-image.png");
    fs.writeFileSync(pasted, "bytes");
    const context = ["pasted-image.png"];
    const mine = { ...made.draft, context };
    writeDraftFile(made.file, mine);
    writeDraftFile(path.join(made.dir, "DRAFT 2.md"), {
      ...draft({ id: "d2" }),
      context,
    });

    removeDraft({ ...made, draft: mine });

    expect(fs.existsSync(pasted)).toBe(true);
  });

  it("leaves the folder where another draft is still in it", async () => {
    const made = makeDraftFolder({ draft: draft(), rootDir, timeZone: ZONE });
    writeDraftFile(path.join(made.dir, "DRAFT 2.md"), draft({ id: "d2" }));
    removeDraft(made);
    expect(fs.readdirSync(made.dir)).toEqual(["DRAFT 2.md"]);
    expect((await readDrafts(rootDir)).map((entry) => entry.draft.id)).toEqual([
      "d2",
    ]);
  });

  it("reads nothing from a workspace with no drafts folder", async () => {
    expect(await readDrafts(rootDir)).toEqual([]);
    expect(await findDraft(rootDir, "d1")).toBeUndefined();
  });

  it("writes a draft whole, leaving no temp file behind", async () => {
    const made = makeDraftFolder({ draft: draft(), rootDir, timeZone: ZONE });
    writeDraftFile(made.file, draft({ words: "second thoughts" }));
    expect(fs.readdirSync(made.dir)).toEqual(["DRAFT.md"]);
    expect((await findDraft(rootDir, "d1"))?.draft.words).toBe(
      "second thoughts",
    );
  });
});

describe("reading every draft", () => {
  /** The draft files opened, by name under `Drafts/`. */
  const openedIn = (opened: { mock: { calls: unknown[][] } }) =>
    opened.mock.calls
      .map(([file]) =>
        path
          .relative(draftsFolderDir(rootDir), String(file))
          .split(path.sep)
          .join("/"),
      )
      .toSorted();

  it("reads a file again only once it changes", async () => {
    makeDraftFolder({ draft: draft(), rootDir, timeZone: ZONE });
    const second = makeDraftFolder({
      draft: draft({ id: "d2" }),
      rootDir,
      timeZone: ZONE,
    });
    await readDrafts(rootDir);
    const opened = vi.spyOn(fs.promises, "open");

    await readDrafts(rootDir);
    expect(opened).not.toHaveBeenCalled();

    fs.writeFileSync(
      second.file,
      renderDraftFile(draft({ id: "d2", words: "Edited elsewhere." })),
    );
    expect(
      (await readDrafts(rootDir)).map((entry) => entry.draft.words),
    ).toEqual(["Find a quiet dishwasher.", "Edited elsewhere."]);
    expect(openedIn(opened)).toEqual(["2026-10-14 2/DRAFT.md"]);
  });

  it("reads a file written here again, whatever its stats say", async () => {
    const made = makeDraftFolder({ draft: draft(), rootDir, timeZone: ZONE });
    // A whole second, which setting it again matches exactly.
    const mtime = new Date("2026-10-14T18:30:00.000Z");
    fs.utimesSync(made.file, mtime, mtime);
    await readDrafts(rootDir);

    // The same size, and the same modification time.
    writeDraftFile(made.file, draft({ words: "Find a quiet dishwasher!" }));
    fs.utimesSync(made.file, mtime, mtime);

    expect((await readDrafts(rootDir))[0]?.draft.words).toBe(
      "Find a quiet dishwasher!",
    );
  });

  it.runIf(process.platform === "darwin")(
    "waits for a file kept in the cloud only, off the main thread",
    async () => {
      const made = makeDraftFolder({ draft: draft(), rootDir, timeZone: ZONE });
      const stat = fs.promises.stat;
      // Contents and no blocks on disk: a file only in the cloud.
      vi.spyOn(fs.promises, "stat").mockImplementation(async (file) =>
        Object.assign(await stat(file), { blocks: 0 }),
      );
      const readSync = vi.spyOn(fs, "readFileSync");
      const opened = vi.spyOn(fs.promises, "open");

      expect((await readDrafts(rootDir)).map((entry) => entry.file)).toEqual([
        made.file,
      ]);
      expect(openedIn(opened)).toEqual(["2026-10-14/DRAFT.md"]);
      expect(readSync).not.toHaveBeenCalled();
    },
  );
});

describe("what a draft's folder has that goes with it", () => {
  const names = (entry: Pick<DraftOnDisk, "dir" | "draft">) =>
    draftFolderItems(entry).map(
      (item) => `${item.kind}:${path.basename(item.path)}`,
    );

  it("is every file and folder dropped in beside the draft, whatever the draft names", () => {
    const made = makeDraftFolder({ draft: draft(), rootDir, timeZone: ZONE });
    fs.writeFileSync(path.join(made.dir, "receipt.png"), "bytes");
    fs.mkdirSync(path.join(made.dir, "Plans"));
    expect(names(made)).toEqual(["folder:Plans", "file:receipt.png"]);
  });

  it.each([
    ".DS_Store",
    "._receipt.png",
    ".localized",
    "desktop.ini",
    "Thumbs.db",
    "ehthumbs.db",
    // A Mac's name for a folder's icon, which Windows cannot name a file.
    ...(process.platform === "win32" ? [] : ["Icon\r"]),
    "~$Report.docx",
    "movie.mp4.crdownload",
    "movie.mp4.part",
    "movie.mp4.download",
    "save.tmp",
  ])("passes over %j", (clutter) => {
    const made = makeDraftFolder({ draft: draft(), rootDir, timeZone: ZONE });
    fs.writeFileSync(path.join(made.dir, clutter), "");
    expect(names(made)).toEqual([]);
  });

  it("counts a file a line names inside the folder once", () => {
    const made = makeDraftFolder({ draft: draft(), rootDir, timeZone: ZONE });
    fs.writeFileSync(path.join(made.dir, "receipt.png"), "bytes");
    const with_ = { ...made.draft, context: ["receipt.png"] };
    expect(names({ ...made, draft: with_ })).toEqual(["file:receipt.png"]);
  });

  it("is the draft's own in a folder with its conflict copy", () => {
    const made = makeDraftFolder({ draft: draft(), rootDir, timeZone: ZONE });
    writeDraftFile(path.join(made.dir, "DRAFT 2.md"), draft());
    fs.writeFileSync(path.join(made.dir, "receipt.png"), "bytes");
    expect(ownsDraftFolder(made.dir, "d1")).toBe(true);
    expect(names(made)).toEqual(["file:receipt.png"]);
  });

  it("is only what each draft names where two drafts share the folder", () => {
    const made = makeDraftFolder({ draft: draft(), rootDir, timeZone: ZONE });
    const other = { ...draft({ id: "d2" }), context: ["theirs.png"] };
    writeDraftFile(path.join(made.dir, "DRAFT 2.md"), other);
    for (const name of ["mine.png", "theirs.png", "loose.png"]) {
      fs.writeFileSync(path.join(made.dir, name), "bytes");
    }
    const mine = { ...made.draft, context: ["mine.png"] };
    expect(ownsDraftFolder(made.dir, "d1")).toBe(false);
    expect(names({ ...made, draft: mine })).toEqual(["file:mine.png"]);
    expect(names({ dir: made.dir, draft: other })).toEqual(["file:theirs.png"]);
  });

  it("tells a file in the folder from the draft's own file and from one outside", () => {
    const made = makeDraftFolder({ draft: draft(), rootDir, timeZone: ZONE });
    const inside = path.join(made.dir, "receipt.png");
    fs.writeFileSync(inside, "bytes");
    const outside = path.join(rootDir, "notes.txt");
    fs.writeFileSync(outside, "mine");
    expect(draftFolderItemAt(made.dir, inside)).toBe(
      path.join(fs.realpathSync(made.dir), "receipt.png"),
    );
    for (const refused of [
      made.file,
      outside,
      path.join(made.dir, "gone.png"),
      path.join(made.dir, ".."),
      path.join(made.dir, "."),
      `${made.dir}/..`,
      `${made.dir}/.`,
    ]) {
      expect(draftFolderItemAt(made.dir, refused)).toBeUndefined();
    }
  });

  it("reads a folder a draft names in a shared folder by its line ending in a slash", () => {
    const made = makeDraftFolder({ draft: draft(), rootDir, timeZone: ZONE });
    writeDraftFile(path.join(made.dir, "DRAFT 2.md"), {
      ...draft({ id: "d2" }),
      context: ["Shared/"],
    });
    fs.mkdirSync(path.join(made.dir, "Photos"));
    fs.mkdirSync(path.join(made.dir, "Shared"));
    const mine = { ...made.draft, context: ["Photos/", "Shared/"] };
    expect(names({ ...made, draft: mine })).toEqual([
      "folder:Photos",
      "folder:Shared",
    ]);
    expect(
      [...namedByOtherDrafts(made.dir, "d1")].map((named) =>
        path.basename(named),
      ),
    ).toEqual(["Shared"]);
  });
});

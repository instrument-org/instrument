import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type DraftFile, renderDraftFile } from "./draft-file";
import {
  type DraftOnDisk,
  draftsFolderDir,
  ensureDraftFolder,
  findDraft,
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
      at(ensureDraftFolder({ draft: draft(), rootDir, timeZone: ZONE })),
    ).toMatchInlineSnapshot(`"Drafts/2026-10-14/DRAFT.md"`);
  });

  it("reads the day in the writing device's own zone", () => {
    // Late evening in New York is the next day in London.
    expect(
      at(
        ensureDraftFolder({
          draft: draft(),
          rootDir,
          timeZone: "Europe/London",
        }),
      ),
    ).toMatchInlineSnapshot(`"Drafts/2026-10-14/DRAFT.md"`);
    expect(
      at(
        ensureDraftFolder({
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
    ensureDraftFolder({ draft: draft(), rootDir, timeZone: ZONE });
    ensureDraftFolder({ draft: draft({ id: "d2" }), rootDir, timeZone: ZONE });
    ensureDraftFolder({ draft: draft({ id: "d3" }), rootDir, timeZone: ZONE });
    expect(fs.readdirSync(draftsFolderDir(rootDir)).toSorted())
      .toMatchInlineSnapshot(`
      [
        "2026-10-14",
        "2026-10-14 2",
        "2026-10-14 3",
      ]
    `);
  });

  it("answers with the folder it made when the same draft is asked for again", () => {
    const first = ensureDraftFolder({
      draft: draft(),
      rootDir,
      timeZone: ZONE,
    });
    const again = ensureDraftFolder({
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
        ensureDraftFolder({
          draft: draft(),
          named: 'Tidy up: the "big" one/two',
          rootDir,
          timeZone: ZONE,
        }),
      ),
    ).toMatchInlineSnapshot(`"Drafts/Tidy up the big one two/DRAFT.md"`);
  });

  it("holds the draft whatever its folder is called", () => {
    const made = ensureDraftFolder({ draft: draft(), rootDir, timeZone: ZONE });
    const moved = path.join(draftsFolderDir(rootDir), "my dishwasher notes");
    fs.renameSync(made.dir, moved);
    expect(readDrafts(rootDir).map((entry) => entry.draft.id)).toEqual(["d1"]);
    expect(findDraft(rootDir, "d1")?.dir).toBe(moved);
  });

  it("reads two drafts in one folder as two", () => {
    const { dir } = ensureDraftFolder({
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
      readDrafts(rootDir).map((entry) => [
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

  it("passes over a folder holding no draft, and a file that is not one", () => {
    const stray = path.join(draftsFolderDir(rootDir), "Notes");
    fs.mkdirSync(stray, { recursive: true });
    fs.writeFileSync(path.join(stray, "DRAFT.md"), "---\nid: [1, 2\n---\n");
    fs.writeFileSync(path.join(stray, "thoughts.md"), "Mine.\n");
    expect(readDrafts(rootDir)).toEqual([]);
  });

  it("gives a draft written by hand an id, and writes it into the file", () => {
    const file = path.join(draftsFolderDir(rootDir), "Mine", "DRAFT.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "---\ntopic: tpc_01KF\n---\nCall the plumber.\n");

    const [read] = readDrafts(rootDir);

    expect(read?.draft).toMatchObject({
      topic: "tpc_01KF",
      words: "Call the plumber.",
    });
    expect(fs.readFileSync(file, "utf8")).toContain(
      `id: ${JSON.stringify(read?.draft.id)}`,
    );
    expect(readDrafts(rootDir).map((entry) => entry.draft.id)).toEqual([
      read?.draft.id,
    ]);
  });

  it("takes a draft away with what was pasted into it", () => {
    const made = ensureDraftFolder({ draft: draft(), rootDir, timeZone: ZONE });
    fs.writeFileSync(path.join(made.dir, "pasted-image.png"), "bytes");
    const with_ = {
      ...made.draft,
      context: ["pasted-image.png", "/Users/someone/Documents/quote.pdf"],
    };
    writeDraftFile(made.file, with_);
    removeDraft({ ...made, draft: with_ });
    expect(fs.existsSync(made.dir)).toBe(false);
  });

  it("leaves a folder of the person's that a draft names above its own", () => {
    const victim = path.join(rootDir, "valuable-work");
    fs.mkdirSync(victim, { recursive: true });
    fs.writeFileSync(path.join(victim, "report.txt"), "the person's");
    const made = ensureDraftFolder({ draft: draft(), rootDir, timeZone: ZONE });
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
      const made = ensureDraftFolder({
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

  it("leaves what a draft names through a link out of its folder", () => {
    const victim = path.join(rootDir, "valuable-work");
    fs.mkdirSync(victim, { recursive: true });
    fs.writeFileSync(path.join(victim, "report.txt"), "the person's");
    const made = ensureDraftFolder({ draft: draft(), rootDir, timeZone: ZONE });
    fs.symlinkSync(victim, path.join(made.dir, "out"));
    const with_ = {
      ...made.draft,
      context: [path.join("out", "report.txt")],
    };
    writeDraftFile(made.file, with_);

    removeDraft({ ...made, draft: with_ });

    expect(fs.existsSync(path.join(victim, "report.txt"))).toBe(true);
  });

  it("keeps a pasted file another draft in the folder still names", () => {
    const made = ensureDraftFolder({ draft: draft(), rootDir, timeZone: ZONE });
    const pasted = path.join(made.dir, "pasted-image.png");
    fs.writeFileSync(pasted, "bytes");
    const context = ["pasted-image.png"];
    const mine = { ...made.draft, context };
    writeDraftFile(made.file, mine);
    // A sync engine's conflict copy of the same draft, naming the same file.
    writeDraftFile(path.join(made.dir, "DRAFT 2.md"), {
      ...draft({ id: "d2" }),
      context,
    });

    removeDraft({ ...made, draft: mine });

    expect(fs.existsSync(pasted)).toBe(true);
  });

  it("leaves the folder where another draft is still in it", () => {
    const made = ensureDraftFolder({ draft: draft(), rootDir, timeZone: ZONE });
    writeDraftFile(path.join(made.dir, "DRAFT 2.md"), draft({ id: "d2" }));
    removeDraft(made);
    expect(fs.readdirSync(made.dir)).toEqual(["DRAFT 2.md"]);
    expect(readDrafts(rootDir).map((entry) => entry.draft.id)).toEqual(["d2"]);
  });

  it("leaves the folder where the person put something of their own in it", () => {
    const made = ensureDraftFolder({ draft: draft(), rootDir, timeZone: ZONE });
    fs.writeFileSync(path.join(made.dir, "my-notes.txt"), "mine");
    removeDraft(made);
    expect(fs.readdirSync(made.dir)).toEqual(["my-notes.txt"]);
  });

  it("reads nothing from a workspace with no drafts folder", () => {
    expect(readDrafts(rootDir)).toEqual([]);
    expect(findDraft(rootDir, "d1")).toBeUndefined();
  });

  it("writes a draft whole, leaving no temp file behind", () => {
    const made = ensureDraftFolder({ draft: draft(), rootDir, timeZone: ZONE });
    writeDraftFile(made.file, draft({ words: "second thoughts" }));
    expect(fs.readdirSync(made.dir)).toEqual(["DRAFT.md"]);
    expect(findDraft(rootDir, "d1")?.draft.words).toBe("second thoughts");
  });
});

import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { draftsFolderDir, readDrafts } from "./draft-folder";
import { moveTopLevelDrafts } from "./move-in";

/**
 * The launch sweep that brings drafts a build before kept in the top-level
 * `Drafts/` into `.instrument/drafts/`. Over a real folder, since what is
 * being checked is where the files end up.
 */

let base: string;
let rootDir: string;
let machineDir: string;

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "drafts-in-")));
  rootDir = path.join(base, "workspace");
  machineDir = path.join(base, "machine");
  fs.mkdirSync(rootDir);
});

afterEach(() => {
  fs.rmSync(base, { force: true, recursive: true });
});

function write(file: string, contents = "") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function draft(dir: string, id: string, words = "Find a quiet dishwasher.") {
  write(
    path.join(dir, "DRAFT.md"),
    `---\nid: ${id}\ncreated: 2026-10-14T18:22:04Z\nupdated: 2026-10-14T18:22:04Z\n---\n${words}\n`,
  );
}

/** Every file under the workspace, by its path there. */
function tree(): string[] {
  return fs
    .readdirSync(rootDir, { encoding: "utf8", recursive: true })
    .filter((each) => fs.statSync(path.join(rootDir, each)).isFile())
    .map((each) => each.split(path.sep).join("/"))
    .toSorted();
}

function move() {
  return moveTopLevelDrafts({ machineDir, rootDir });
}

describe("moving the top-level drafts in", () => {
  it("moves each draft folder in with what goes with it, and removes Drafts/", async () => {
    draft(path.join(rootDir, "Drafts", "2026-10-14"), "d1");
    write(path.join(rootDir, "Drafts", "2026-10-14", "receipt.png"), "png");
    draft(path.join(rootDir, "Drafts", "2026-10-15"), "d2");
    write(path.join(rootDir, "Drafts", ".DS_Store"), "");

    expect(move().left).toEqual([]);

    expect(tree()).toMatchInlineSnapshot(`
      [
        ".instrument/drafts/2026-10-14/DRAFT.md",
        ".instrument/drafts/2026-10-14/receipt.png",
        ".instrument/drafts/2026-10-15/DRAFT.md",
      ]
    `);
    expect((await readDrafts(rootDir)).map((entry) => entry.draft.id)).toEqual([
      "d1",
      "d2",
    ]);
  });

  it("numbers a folder whose name the drafts folder already has", async () => {
    draft(path.join(draftsFolderDir(rootDir), "2026-10-14"), "here");
    draft(path.join(rootDir, "Drafts", "2026-10-14"), "there");

    move();

    expect(tree()).toMatchInlineSnapshot(`
      [
        ".instrument/drafts/2026-10-14 2/DRAFT.md",
        ".instrument/drafts/2026-10-14/DRAFT.md",
      ]
    `);
    expect(
      (await readDrafts(rootDir)).map((entry) => entry.draft.id).toSorted(),
    ).toEqual(["here", "there"]);
  });

  it("leaves a file of the person's in Drafts/, and Drafts/ with it", () => {
    draft(path.join(rootDir, "Drafts", "2026-10-14"), "d1");
    write(path.join(rootDir, "Drafts", "notes.txt"), "mine");

    move();

    expect(tree()).toEqual([
      ".instrument/drafts/2026-10-14/DRAFT.md",
      "Drafts/notes.txt",
    ]);
  });

  it("leaves a folder of the person's that holds no draft", () => {
    draft(path.join(rootDir, "Drafts", "2026-10-14"), "d1");
    write(path.join(rootDir, "Drafts", "Novel", "chapter1.docx"), "words");
    write(path.join(rootDir, "Drafts", "Novel", "draft.md"), "mine");

    move();

    expect(tree()).toEqual([
      ".instrument/drafts/2026-10-14/DRAFT.md",
      "Drafts/Novel/chapter1.docx",
      "Drafts/Novel/draft.md",
    ]);
  });

  it("writes a stored path into a moved folder where it went", () => {
    draft(path.join(rootDir, "Drafts", "2026-10-14"), "d1");
    const was = path.join(rootDir, "Drafts", "2026-10-14");
    const permissions = path.join(
      machineDir,
      WORKSPACE_MACHINE_ENTRIES.permissions,
    );
    write(permissions, JSON.stringify({ folders: [{ path: was }] }));

    move();

    expect(JSON.parse(fs.readFileSync(permissions, "utf8"))).toEqual({
      folders: [{ path: path.join(draftsFolderDir(rootDir), "2026-10-14") }],
    });
  });

  it("does nothing where there is no top-level Drafts/", () => {
    expect(move()).toEqual({ done: [], left: [] });
    expect(fs.existsSync(draftsFolderDir(rootDir))).toBe(false);
  });
});

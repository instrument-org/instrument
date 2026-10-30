import { PRIVATE_FOLDER_NAME } from "@instrument-org/shared";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { workspaceLayout } from "../workspace-layout";
import { makeDraftFolder, readDrafts } from "./draft-folder";
import { migrateDraftsToFolder } from "./migrate";

/**
 * The drafts an earlier build kept hidden, brought out to `Drafts/`. Over a
 * real folder, since what is being checked is where the files end up.
 */

const ZONE = "America/New_York";

let rootDir: string;

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "drafts-migrate-"));
});

afterEach(() => {
  fs.rmSync(rootDir, { force: true, recursive: true });
});

/** A draft as an earlier build left it: words in a file, the rest beside them. */
function hiddenDraft(
  id: string,
  {
    pasted = {},
    record = {},
    words = "Find a quiet dishwasher.",
  }: {
    pasted?: Record<string, string>;
    record?: Record<string, unknown>;
    words?: string;
  } = {},
): string {
  const dir = path.join(workspaceLayout(rootDir).draftsDir, id);
  fs.mkdirSync(path.join(dir, PRIVATE_FOLDER_NAME), { recursive: true });
  fs.writeFileSync(path.join(dir, "draft.md"), words);
  fs.writeFileSync(
    path.join(dir, PRIVATE_FOLDER_NAME, "settings.json"),
    JSON.stringify({
      createdAt: Date.parse("2026-10-14T18:22:04.000Z"),
      updatedAt: Date.parse("2026-10-14T18:25:00.000Z"),
      ...record,
    }),
  );
  for (const [name, bytes] of Object.entries(pasted)) {
    fs.writeFileSync(path.join(dir, name), bytes);
  }
  return dir;
}

/** What is in `Drafts/` now, as paths under the workspace. */
function tree(): string[] {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const where = path.join(dir, entry.name);
      return entry.isDirectory()
        ? walk(where)
        : // Spelled with "/" between the names, so the snapshots below read
          // the same whatever this computer writes between its own.
          [path.relative(rootDir, where).split(path.sep).join("/")];
    });
  const drafts = path.join(rootDir, "Drafts");
  return fs.existsSync(drafts) ? walk(drafts).toSorted() : [];
}

function migrate() {
  return migrateDraftsToFolder({ rootDir, timeZone: ZONE });
}

describe("bringing the hidden drafts out", () => {
  it("makes a folder named for the day, with the words and the record in one file", async () => {
    hiddenDraft("01KFD1", { record: { topicId: "tpc_01KF" } });

    const migration = await migrate();

    expect(migration.left).toEqual([]);
    expect(tree()).toMatchInlineSnapshot(`
      [
        "Drafts/2026-10-14/DRAFT.md",
      ]
    `);
    expect(fs.readFileSync(path.join(rootDir, tree()[0] ?? ""), "utf8"))
      .toMatchInlineSnapshot(`
        "---
        id: "01KFD1"
        created: 2026-10-14T18:22:04Z
        updated: 2026-10-14T18:25:00Z
        topic: "tpc_01KF"
        ---

        Find a quiet dishwasher.
        "
      `);
  });

  it("moves what was pasted into the draft beside it, where it goes with the draft without a line", async () => {
    hiddenDraft("01KFD1", {
      pasted: { "pasted-image.png": "the bytes" },
      record: {
        attached: [
          {
            kind: "file",
            mimeType: "image/png",
            name: "pasted-image.png",
            path: "pasted-image.png",
            size: 9,
          },
        ],
      },
    });

    await migrate();

    expect(tree()).toMatchInlineSnapshot(`
      [
        "Drafts/2026-10-14/DRAFT.md",
        "Drafts/2026-10-14/pasted-image.png",
      ]
    `);
    expect((await readDrafts(rootDir))[0]?.draft.context).toBeUndefined();
  });

  it("leaves a file the draft attached where it is on disk", async () => {
    const elsewhere = path.join(rootDir, "quote.pdf");
    fs.writeFileSync(elsewhere, "a quote");
    hiddenDraft("01KFD1", {
      record: { attached: [{ kind: "file", path: elsewhere }] },
    });

    await migrate();

    expect((await readDrafts(rootDir))[0]?.draft.context).toEqual([
      "workspace:/quote.pdf",
    ]);
    expect(fs.existsSync(elsewhere)).toBe(true);
  });

  it("leaves out something the draft named that is not there any more", async () => {
    hiddenDraft("01KFD1", {
      record: { attached: [{ kind: "file", path: "pasted-image.png" }] },
    });

    const migration = await migrate();

    expect(migration.done[0]).toContain("without pasted-image.png");
    expect((await readDrafts(rootDir))[0]?.draft.context).toBeUndefined();
  });

  it("numbers a pasted file whose name the day's folder already holds", async () => {
    makeDraftFolder({
      draft: {
        created: new Date("2026-10-14T09:00:00.000Z"),
        id: "already",
        updated: new Date("2026-10-14T09:00:00.000Z"),
        words: "Earlier.",
      },
      rootDir,
      timeZone: ZONE,
    });
    hiddenDraft("01KFD1", {
      pasted: { "pasted-image.png": "the bytes" },
      record: {
        attached: [{ kind: "file", path: "pasted-image.png" }],
      },
    });
    fs.writeFileSync(
      path.join(rootDir, "Drafts", "2026-10-14", "pasted-image.png"),
      "another one",
    );

    await migrate();

    // The draft lands in a folder of its own, so the name is free there; a
    // name already taken is numbered rather than written over.
    expect(tree()).toMatchInlineSnapshot(`
      [
        "Drafts/2026-10-14 2/DRAFT.md",
        "Drafts/2026-10-14 2/pasted-image.png",
        "Drafts/2026-10-14/DRAFT.md",
        "Drafts/2026-10-14/pasted-image.png",
      ]
    `);
    expect(
      fs.readFileSync(
        path.join(rootDir, "Drafts", "2026-10-14 2", "pasted-image.png"),
        "utf8",
      ),
    ).toBe("the bytes");
  });

  it("takes the old folder away once the draft has left it", async () => {
    const was = hiddenDraft("01KFD1");

    await migrate();

    expect(fs.existsSync(was)).toBe(false);
    expect(fs.existsSync(workspaceLayout(rootDir).draftsDir)).toBe(false);
  });

  it("brings a file left in the old folder out with the draft", async () => {
    const was = hiddenDraft("01KFD1");
    // The old folder was the app's own, inside `.instrument/`, so nothing is
    // left behind in a folder that is about to be forgotten.
    fs.writeFileSync(path.join(was, "notes.txt"), "mine");

    await migrate();

    expect(tree()).toMatchInlineSnapshot(`
      [
        "Drafts/2026-10-14/DRAFT.md",
        "Drafts/2026-10-14/notes.txt",
      ]
    `);
    expect(fs.existsSync(was)).toBe(false);
  });

  it("changes nothing the second time it runs", async () => {
    hiddenDraft("01KFD1", { pasted: { "sink.png": "the bytes" } });
    hiddenDraft("01KFD2", { words: "And a fridge." });

    await migrate();
    const once = tree();
    const again = await migrate();

    expect(again.done).toEqual([]);
    expect(tree()).toEqual(once);
    expect((await readDrafts(rootDir)).map((entry) => entry.draft.id)).toEqual([
      "01KFD1",
      "01KFD2",
    ]);
  });

  it("leaves a draft already in Drafts alone, whatever the old folder holds", async () => {
    hiddenDraft("01KFD1", { words: "the old words" });
    await migrate();
    hiddenDraft("01KFD1", { words: "written again by an older build" });

    const migration = await migrate();

    expect(migration.left).toMatchInlineSnapshot(`
      [
        {
          "reason": "the draft it holds is already in Drafts",
          "where": "${path.join(workspaceLayout(rootDir).draftsDir, "01KFD1")}",
        },
      ]
    `);
    expect(
      (await readDrafts(rootDir)).map((entry) => entry.draft.words),
    ).toEqual(["the old words"]);
  });

  it("does nothing for a workspace that never hid any", async () => {
    expect(await migrate()).toEqual({ done: [], left: [] });
    expect(tree()).toEqual([]);
  });

  it("reads a draft with no words as one with none", async () => {
    const was = hiddenDraft("01KFD1");
    fs.rmSync(path.join(was, "draft.md"));

    await migrate();

    expect((await readDrafts(rootDir))[0]?.draft.words).toBe("");
  });
});

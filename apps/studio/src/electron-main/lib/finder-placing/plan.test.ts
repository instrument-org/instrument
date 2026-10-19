import { describe, expect, it } from "vitest";

import {
  type Answer,
  clashesOf,
  type ItemKind,
  type PlaceRequest,
  planPlacing,
} from "./plan";

// "résumé.pdf" with its accents as separate marks, as the Mac's older disks
// and many downloads spell it.
const DECOMPOSED = "re\u0301sume\u0301.pdf";

// Identities by a number: folders above everything share the low ones.
const id = (n: number) => ({ dev: 1, ino: String(n) });

type Source = {
  above?: number[];
  id: number;
  kind?: ItemKind;
  name: string;
  otherDisk?: true;
  path?: string;
};

/**
 * A request into `/dest` (identity 2, under `/`), from `/other` (3) unless a
 * source says otherwise, on a disk that compares names like the Mac's.
 */
function requestAsAsked({
  answers = {},
  caseSensitive = false,
  chain = [2, 1],
  entries = [],
  op = "copy",
  sources,
  unicodeSensitive = false,
}: {
  answers?: Record<string, Answer>;
  caseSensitive?: boolean;
  /** The destination, then each folder above it. */
  chain?: number[];
  entries?: { id: number; kind?: ItemKind; name: string }[];
  op?: "copy" | "move";
  /** What each Replace was shown in its way; left out, what the dialog would have shown. */
  replacing?: Record<string, number>;
  sources: Source[];
  unicodeSensitive?: boolean;
}): PlaceRequest {
  return {
    answers,
    copyName: (stem, n) => (n === 1 ? `${stem} copy` : `${stem} copy ${n}`),
    entries: entries.map((entry) => ({
      identity: id(entry.id),
      kind: entry.kind ?? "file",
      name: entry.name,
    })),
    folder: { chain: chain.map(id), path: "/dest" },
    join: (folder, name) => `${folder}/${name}`,
    names: { caseSensitive, unicodeSensitive },
    op,
    sources: sources.map((source) => ({
      above: (source.above ?? [3, 1]).map(id),
      identity: id(source.id),
      kind: source.kind ?? "file",
      name: source.name,
      onDestinationDisk: !source.otherDisk,
      path: source.path ?? `/other/${source.name}`,
    })),
    token: "t",
  };
}

/** A request the way the app sends one: each Replace naming what the dialog showed in its way. */
function request(options: Parameters<typeof requestAsAsked>[0]) {
  const asked = requestAsAsked(options);
  return {
    ...asked,
    replacing: options.replacing
      ? Object.fromEntries(
          Object.entries(options.replacing).map(([source, n]) => [
            source,
            id(n),
          ]),
        )
      : Object.fromEntries(
          clashesOf(asked).flatMap((clash) =>
            asked.answers[clash.path] === "replace"
              ? [[clash.path, clash.with.identity]]
              : [],
          ),
        ),
  };
}

/** A plan as one line per step, the way a reviewer reads it. */
function read(placing: PlaceRequest) {
  const clashes = clashesOf(placing).map(
    (clash) =>
      `clash ${clash.name} (${clash.kind}) with ${clash.with.by} (${clash.with.kind})${clash.replaceable ? "" : ", not replaceable"}`,
  );
  const plan = planPlacing(placing);
  if ("refusal" in plan) {
    return [...clashes, `refused: ${plan.refusal}`];
  }
  return [
    ...clashes,
    ...plan.steps.map((step) =>
      step.kind === "skip"
        ? `skip ${step.source} (${step.why})`
        : `${step.how} ${step.source} -> ${step.to}${step.staging ? ` via ${step.staging}` : ""}${step.replaces ? `, replacing ${step.replaces.path}` : ""}`,
    ),
  ];
}

describe("planning a drop, a paste or a move", () => {
  it("copies into a folder with nothing in the way", () => {
    expect(read(request({ sources: [{ id: 10, name: "notes.txt" }] })))
      .toMatchInlineSnapshot(`
      [
        "copy /other/notes.txt -> /dest/notes.txt via /dest/.instrument-placing-t-0",
      ]
    `);
  });

  it("finds a clash between names that differ only in case, on a disk that ignores case", () => {
    expect(
      read(
        request({
          answers: { "/other/Notes.txt": "keepBoth" },
          entries: [{ id: 20, name: "notes.txt" }],
          sources: [{ id: 10, name: "Notes.txt" }],
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "clash Notes.txt (file) with entry (file)",
        "copy /other/Notes.txt -> /dest/Notes 2.txt via /dest/.instrument-placing-t-0",
      ]
    `);
  });

  it("finds no clash between names that differ in case, on a disk that tells them apart", () => {
    expect(
      read(
        request({
          caseSensitive: true,
          entries: [{ id: 20, name: "notes.txt" }],
          sources: [{ id: 10, name: "Notes.txt" }],
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "copy /other/Notes.txt -> /dest/Notes.txt via /dest/.instrument-placing-t-0",
      ]
    `);
  });

  it("takes the same item under another spelling of its name for one already there", () => {
    expect(
      read(
        request({
          entries: [{ id: 10, name: "NOTES.txt" }],
          sources: [{ id: 10, name: "notes.txt" }],
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "copy /other/notes.txt -> /dest/notes copy.txt via /dest/.instrument-placing-t-0",
      ]
    `);
  });

  it("finds a clash between a composed and a decomposed accent on the Mac's disks", () => {
    expect(
      read(
        request({
          answers: { [`/other/${DECOMPOSED}`]: "replace" },
          entries: [{ id: 20, name: "résumé.pdf" }],
          sources: [{ id: 10, name: DECOMPOSED }],
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "clash résumé.pdf (file) with entry (file)",
        "copy /other/résumé.pdf -> /dest/résumé.pdf via /dest/.instrument-placing-t-0, replacing /dest/résumé.pdf",
      ]
    `);
  });

  it("keeps a composed and a decomposed accent apart where the disk does", () => {
    expect(
      read(
        request({
          entries: [{ id: 20, name: "résumé.pdf" }],
          sources: [{ id: 10, name: DECOMPOSED }],
          unicodeSensitive: true,
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "copy /other/résumé.pdf -> /dest/résumé.pdf via /dest/.instrument-placing-t-0",
      ]
    `);
  });

  it("asks about two sources with one name, and keeps both when told", () => {
    expect(
      read(
        request({
          answers: { "/third/notes.txt": "keepBoth" },
          sources: [
            { id: 10, name: "notes.txt" },
            {
              above: [4, 1],
              id: 11,
              name: "notes.txt",
              path: "/third/notes.txt",
            },
          ],
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "clash notes.txt (file) with source (file), not replaceable",
        "copy /other/notes.txt -> /dest/notes.txt via /dest/.instrument-placing-t-0",
        "copy /third/notes.txt -> /dest/notes 2.txt via /dest/.instrument-placing-t-1",
      ]
    `);
  });

  it("refuses to let one source replace another", () => {
    expect(
      read(
        request({
          answers: { "/third/notes.txt": "replace" },
          sources: [
            { id: 10, name: "notes.txt" },
            {
              above: [4, 1],
              id: 11,
              name: "notes.txt",
              path: "/third/notes.txt",
            },
          ],
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "clash notes.txt (file) with source (file), not replaceable",
        "refused: “notes.txt” can’t replace another item you’re putting there.",
      ]
    `);
  });

  it("leaves a moved item already in the destination where it is", () => {
    expect(
      read(
        request({
          entries: [{ id: 10, name: "notes.txt" }],
          op: "move",
          sources: [
            {
              above: [2, 1],
              id: 10,
              name: "notes.txt",
              path: "/dest/notes.txt",
            },
          ],
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "skip /dest/notes.txt (already-there)",
      ]
    `);
  });

  it("names a copy back into its own folder the way the system names a copy, without asking", () => {
    expect(
      read(
        request({
          entries: [
            { id: 10, name: "notes.txt" },
            { id: 11, name: "notes copy.txt" },
          ],
          sources: [
            {
              above: [2, 1],
              id: 10,
              name: "notes.txt",
              path: "/dest/notes.txt",
            },
          ],
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "copy /dest/notes.txt -> /dest/notes copy 2.txt via /dest/.instrument-placing-t-0",
      ]
    `);
  });

  it("refuses to put a folder into itself", () => {
    expect(
      read(
        request({
          sources: [
            { above: [1], id: 2, kind: "folder", name: "dest", path: "/dest" },
          ],
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "refused: “dest” can’t go into itself.",
      ]
    `);
  });

  it("refuses to put a folder into a folder inside it", () => {
    // `/top` moving into `/top/dest`.
    expect(
      read(
        request({
          chain: [2, 5, 1],
          op: "move",
          sources: [
            { above: [1], id: 5, kind: "folder", name: "top", path: "/top" },
          ],
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "refused: “top” can’t go into itself.",
      ]
    `);
  });

  it("moves nothing onto the same item under another spelling of its name", () => {
    expect(
      read(
        request({
          entries: [{ id: 10, name: "NOTES.txt" }],
          op: "move",
          sources: [{ id: 10, name: "notes.txt" }],
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "skip /other/notes.txt (already-there)",
      ]
    `);
  });

  it("refuses to replace one of the items being placed", () => {
    expect(
      read(
        request({
          answers: { "/other/notes.txt": "replace" },
          entries: [{ id: 11, name: "notes.txt" }],
          op: "move",
          sources: [
            { id: 10, name: "notes.txt" },
            {
              above: [2, 1],
              id: 11,
              name: "notes.txt",
              path: "/dest/notes.txt",
            },
          ],
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "clash notes.txt (file) with entry (file), not replaceable",
        "refused: “notes.txt” can’t be replaced, since it is one of the items you’re putting there or holds one.",
      ]
    `);
  });

  it("refuses to replace a folder holding an item being placed", () => {
    // `/dest/pics/pics` moving up into `/dest` would replace `/dest/pics`.
    expect(
      read(
        request({
          answers: { "/dest/pics/pics": "replace" },
          entries: [{ id: 20, kind: "folder", name: "pics" }],
          op: "move",
          sources: [
            {
              above: [20, 2, 1],
              id: 21,
              kind: "folder",
              name: "pics",
              path: "/dest/pics/pics",
            },
          ],
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "clash pics (folder) with entry (folder), not replaceable",
        "refused: “pics” can’t be replaced, since it is one of the items you’re putting there or holds one.",
      ]
    `);
  });

  it("replaces a folder with a file, and a file with a folder", () => {
    expect(
      read(
        request({
          answers: { "/other/a": "replace", "/other/b": "replace" },
          entries: [
            { id: 20, kind: "folder", name: "a" },
            { id: 21, name: "b" },
          ],
          op: "move",
          sources: [
            { id: 10, name: "a" },
            { id: 11, kind: "folder", name: "b" },
          ],
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "clash a (file) with entry (folder)",
        "clash b (folder) with entry (file)",
        "rename /other/a -> /dest/a, replacing /dest/a",
        "rename /other/b -> /dest/b, replacing /dest/b",
      ]
    `);
  });

  it("places a link as a link, replacing a link with it", () => {
    expect(
      read(
        request({
          answers: { "/other/latest": "replace" },
          entries: [{ id: 20, kind: "link", name: "latest" }],
          sources: [{ id: 10, kind: "link", name: "latest" }],
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "clash latest (link) with entry (link)",
        "copy /other/latest -> /dest/latest via /dest/.instrument-placing-t-0, replacing /dest/latest",
      ]
    `);
  });

  it("numbers a package as one item, before its extension", () => {
    expect(
      read(
        request({
          answers: { "/other/Notes.app": "keepBoth" },
          entries: [{ id: 20, kind: "package", name: "Notes.app" }],
          sources: [{ id: 10, kind: "package", name: "Notes.app" }],
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "clash Notes.app (package) with entry (package)",
        "copy /other/Notes.app -> /dest/Notes 2.app via /dest/.instrument-placing-t-0",
      ]
    `);
  });

  it("numbers a kept folder at the end of its name, past names already taken", () => {
    expect(
      read(
        request({
          answers: { "/other/v1.2": "keepBoth" },
          entries: [
            { id: 20, kind: "folder", name: "v1.2" },
            { id: 21, kind: "folder", name: "v1.2 2" },
          ],
          sources: [{ id: 10, kind: "folder", name: "v1.2" }],
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "clash v1.2 (folder) with entry (folder)",
        "copy /other/v1.2 -> /dest/v1.2 3 via /dest/.instrument-placing-t-0",
      ]
    `);
  });

  it("copies rather than moves onto another disk, leaving the source where it is, as the Finder does", () => {
    expect(
      read(
        request({
          op: "move",
          sources: [{ id: 10, name: "notes.txt", otherDisk: true }],
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "copy /other/notes.txt -> /dest/notes.txt via /dest/.instrument-placing-t-0",
      ]
    `);
  });

  it("leaves a skipped item, and places the rest", () => {
    expect(
      read(
        request({
          answers: { "/other/a.txt": "skip" },
          entries: [{ id: 20, name: "a.txt" }],
          sources: [
            { id: 10, name: "a.txt" },
            { id: 11, name: "b.txt" },
          ],
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "clash a.txt (file) with entry (file)",
        "skip /other/a.txt (answered)",
        "copy /other/b.txt -> /dest/b.txt via /dest/.instrument-placing-t-1",
      ]
    `);
  });

  it("refuses a replace once the name holds something other than what was asked about", () => {
    expect(
      read(
        request({
          answers: { "/other/notes.txt": "replace" },
          entries: [{ id: 21, name: "notes.txt" }],
          replacing: { "/other/notes.txt": 20 },
          sources: [{ id: 10, name: "notes.txt" }],
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "clash notes.txt (file) with entry (file)",
        "refused: “notes.txt” changed after you were asked about it, so nothing was done. Try again to choose what happens to it.",
      ]
    `);
  });

  it("refuses a clash it was given no answer for, such as one that appeared since it asked", () => {
    expect(
      read(
        request({
          entries: [{ id: 20, name: "notes.txt" }],
          sources: [{ id: 10, name: "notes.txt" }],
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "clash notes.txt (file) with entry (file)",
        "refused: Something named “notes.txt” is already there. Try again to choose what happens to it.",
      ]
    `);
  });
});

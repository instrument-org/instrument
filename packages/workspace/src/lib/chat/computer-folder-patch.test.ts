import { describe, expect, it } from "vitest";

import { type ComputerFolder, type ComputerListing } from "./computer";
import { applyFolderPatch, diffFolder } from "./computer-folder-patch";

const listing = (
  entries: ComputerListing["entries"],
  total = entries.length,
): ComputerListing => ({
  display: "~/Downloads",
  entries,
  kind: "listing",
  path: "/Users/mac-user/Downloads",
  total,
  truncated: false,
});

const file = (name: string, size = 1) => ({
  kind: "file" as const,
  name,
  path: `/Users/mac-user/Downloads/${name}`,
  size,
});

describe("diffFolder", () => {
  it("is nothing when the two reads match", () => {
    const folder = listing([file("a.txt")]);
    expect(diffFolder(folder, structuredClone(folder))).toBeUndefined();
  });

  it("names what is new or changed whole, and what went by path", () => {
    expect(
      diffFolder(
        listing([file("a.txt"), file("b.txt"), file("c.txt")]),
        listing([file("a.txt"), file("b.txt", 2), file("d.txt")]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "head": {
          "display": "~/Downloads",
          "kind": "listing",
          "path": "/Users/mac-user/Downloads",
          "total": 3,
          "truncated": false,
        },
        "kind": "patch",
        "removed": [
          "/Users/mac-user/Downloads/c.txt",
        ],
        "upserts": [
          {
            "kind": "file",
            "name": "b.txt",
            "path": "/Users/mac-user/Downloads/b.txt",
            "size": 2,
          },
          {
            "kind": "file",
            "name": "d.txt",
            "path": "/Users/mac-user/Downloads/d.txt",
            "size": 1,
          },
        ],
      }
    `);
  });

  it("sends a change to the listing's own fields alone", () => {
    expect(
      diffFolder(listing([file("a.txt")], 1), listing([file("a.txt")], 2)),
    ).toMatchObject({ kind: "patch", removed: [], upserts: [] });
  });

  it("sends the whole folder when a listing becomes a refusal", () => {
    const refused: ComputerFolder = {
      display: "~/Downloads",
      kind: "refused",
      path: "/Users/mac-user/Downloads",
      reason: "system",
    };
    expect(diffFolder(listing([file("a.txt")]), refused)).toEqual({
      folder: refused,
      kind: "snapshot",
    });
  });
});

describe("applyFolderPatch", () => {
  it("turns one read into the next, in the listing's order", () => {
    const before = listing([file("a.txt"), file("c.txt"), file("file 10")]);
    const after = listing([
      { kind: "folder", name: "z", path: "/Users/mac-user/Downloads/z" },
      file("a.txt", 5),
      file("file 2"),
      file("file 10"),
    ]);
    const event = diffFolder(before, after);
    if (!event) {
      throw new Error("expected a change");
    }
    expect(applyFolderPatch(before, event)).toEqual(after);
  });

  it("lands on a listing another reader read since, by path", () => {
    const sent = listing([file("a.txt")]);
    const event = diffFolder(sent, listing([file("a.txt"), file("b.txt")]));
    if (!event) {
      throw new Error("expected a change");
    }
    const newer = listing([file("a.txt", 9), file("b.txt")]);
    expect(applyFolderPatch(newer, event)).toEqual(
      listing([file("a.txt", 9), file("b.txt")]),
    );
  });

  it("is nothing for a patch to a folder not held as a listing", () => {
    const event = diffFolder(listing([]), listing([file("a.txt")]));
    if (!event) {
      throw new Error("expected a change");
    }
    expect(applyFolderPatch(undefined, event)).toBeUndefined();
  });
});

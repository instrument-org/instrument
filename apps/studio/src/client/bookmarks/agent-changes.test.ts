import {
  applyBookmarkOps,
  type Bookmarks,
  OTHER_ROOT,
} from "@/shared/bookmarks";
import { type WindowTabAction } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import {
  agentChangeOps,
  bookmarkChangesBetween,
  undoBookmarkChanges,
} from "./agent-changes";

type Change = Extract<WindowTabAction, { kind: "changeBookmarks" }>["change"];

const STATE = applyBookmarkOps(
  {
    bookmarks: [
      { id: "a", order: 0, title: "A", url: "https://a.example/" },
      {
        folder: "work",
        id: "b",
        order: 0,
        title: "B",
        url: "https://b.example/",
      },
      { id: "c", order: 2, title: "C", url: "https://c.example/" },
      {
        id: "d",
        order: 0,
        root: OTHER_ROOT,
        title: "D",
        url: "https://d.example/",
      },
      {
        folder: "reading",
        id: "e",
        order: 0,
        title: "E",
        url: "https://e.example/",
      },
    ],
    folders: [
      { id: "work", order: 1, title: "Work" },
      { id: "reading", order: 1, root: OTHER_ROOT, title: "Reading" },
    ],
  },
  [],
);

/** The bookmarks and folders as the Bookmarks page lists them: each place, with what is in it in order. */
function shape({ bookmarks, folders }: Bookmarks) {
  const places: Record<string, string[]> = {};
  const add = (place: string, words: string) => {
    places[place] = [...(places[place] ?? []), words];
  };
  const loose = [
    ...folders.map((each) => ({ ...each, words: `${each.title}/` })),
    ...bookmarks
      .filter((each) => each.folder === undefined)
      .map((each) => ({ ...each, words: each.title })),
  ].toSorted((a, b) => a.order - b.order);
  for (const each of loose) {
    add(each.root === OTHER_ROOT ? "All" : "Bar", each.words);
  }
  for (const each of bookmarks.filter((one) => one.folder !== undefined)) {
    add(each.folder ?? "", each.title);
  }
  return places;
}

function make(state: Bookmarks, ...changes: Change[]): Bookmarks {
  return changes.reduce((so, change) => {
    const made = agentChangeOps(so, change);
    if ("error" in made) {
      throw new Error(made.error);
    }
    return applyBookmarkOps(so, made.ops);
  }, state);
}

describe("agentChangeOps", () => {
  it("moves bookmarks into a folder, last, in the order named", () => {
    expect(
      shape(make(STATE, { ids: ["d", "a"], to: "work", type: "move" })),
    ).toMatchObject({ Bar: ["Work/", "C"], work: ["B", "D", "A"] });
  });

  it("moves beside another, into its place", () => {
    expect(
      shape(make(STATE, { before: "c", ids: ["d", "e"], type: "move" })),
    ).toMatchObject({ Bar: ["A", "Work/", "D", "E", "C"] });
    expect(
      shape(make(STATE, { after: "a", ids: ["work"], type: "move" })),
    ).toMatchObject({ Bar: ["A", "Work/", "C"] });
    expect(
      shape(make(STATE, { before: "a", ids: ["work"], type: "move" })),
    ).toMatchObject({ Bar: ["Work/", "A", "C"] });
  });

  it("makes no ops for what is so already", () => {
    expect(
      agentChangeOps(STATE, { ids: ["c"], to: "bar", type: "move" }),
    ).toEqual({ ops: [] });
  });

  it.each<[string, Change]>([
    ["goes in no other folder", { ids: ["work"], to: "all", type: "move" }],
    ["goes in no other folder", { ids: ["work"], to: "reading", type: "move" }],
    ["beside itself", { before: "a", ids: ["a"], type: "move" }],
    ["not in that place", { before: "d", ids: ["a"], to: "bar", type: "move" }],
    ["no bookmark or folder", { id: "z", title: "Z", type: "rename" }],
    ["no bookmark or folder", { ids: ["a", "z"], type: "remove" }],
    ["needs a name", { id: "work", title: "", type: "rename" }],
    [
      "has no address",
      { id: "work", type: "setUrl", url: "https://z.example/" },
    ],
    [
      "bookmarked already",
      { id: "a", type: "setUrl", url: "https://b.example" },
    ],
    ["already has a folder", { root: "bar", title: "work", type: "newFolder" }],
  ])("refuses what %s: %j", (said, change) => {
    const made = agentChangeOps(STATE, change);

    expect("error" in made ? made.error : "").toContain(said);
  });
});

describe("undoBookmarkChanges", () => {
  const undo = (
    now: Bookmarks,
    changes: ReturnType<typeof bookmarkChangesBetween>,
  ) => {
    const { ops, ...counts } = undoBookmarkChanges(now, changes);
    return { ...counts, state: applyBookmarkOps(now, ops) };
  };

  it.each<[string, Change[]]>([
    ["a move", [{ ids: ["a", "e"], to: "work", type: "move" }]],
    ["a folder's order", [{ ids: ["work"], type: "move", before: "a" }]],
    [
      "names and an address",
      [
        { id: "a", title: "Alpha", type: "rename" },
        { id: "work", title: "Jobs", type: "rename" },
        { id: "a", type: "setUrl", url: "https://z.example/" },
      ],
    ],
    ["a removed bookmark", [{ ids: ["d", "e"], type: "remove" }]],
    ["a removed folder", [{ ids: ["reading"], type: "remove" }]],
  ])("puts back %s exactly", (_, made) => {
    const after = make(STATE, ...made);
    const changes = bookmarkChangesBetween(STATE, after);
    const { skipped, state, undone } = undo(after, changes);

    expect(changes.length).toBeGreaterThan(0);
    expect({ skipped, undone }).toEqual({ skipped: 0, undone: changes.length });
    expect(state).toEqual(STATE);
  });

  it("takes out a folder it made, with what was filed in it back", () => {
    const withFolder = make(STATE, {
      root: "all",
      title: "New",
      type: "newFolder",
    });
    const folder = withFolder.folders.find((each) => each.title === "New");
    const after = make(withFolder, {
      ids: ["a", "d"],
      to: folder?.id ?? "",
      type: "move",
    });

    expect(undo(after, bookmarkChangesBetween(STATE, after)).state).toEqual(
      STATE,
    );
  });

  it("leaves a folder it made that has a bookmark of the person's", () => {
    const withFolder = make(STATE, {
      root: "bar",
      title: "New",
      type: "newFolder",
    });
    const changes = bookmarkChangesBetween(STATE, withFolder);
    const id = changes[0]?.id ?? "";
    const now = make(withFolder, { ids: ["a"], to: id, type: "move" });

    expect(undo(now, changes)).toMatchObject({ skipped: 1, undone: 0 });
  });

  it("skips what the person changed since, and puts back the rest", () => {
    const after = make(
      STATE,
      { id: "a", title: "Alpha", type: "rename" },
      { ids: ["d"], type: "remove" },
    );
    const changes = bookmarkChangesBetween(STATE, after);
    const now = make(after, { id: "a", title: "Mine", type: "rename" });
    const { state, ...counts } = undo(now, changes);

    expect(counts).toEqual({ skipped: 1, undone: 1 });
    expect(state.bookmarks.find((each) => each.id === "a")?.title).toBe("Mine");
    expect(state.bookmarks.some((each) => each.id === "d")).toBe(true);
  });

  it("keeps no address twice where the person bookmarked it again", () => {
    const after = make(STATE, { ids: ["d"], type: "remove" });
    const changes = bookmarkChangesBetween(STATE, after);
    const now = applyBookmarkOps(after, [
      {
        bookmark: { id: "d2", order: 5, title: "D", url: "https://d.example" },
        type: "add",
      },
    ]);

    expect(undo(now, changes)).toMatchObject({ skipped: 1, undone: 0 });
  });

  it("takes back one removed and added again by the turn", () => {
    const after = applyBookmarkOps(STATE, [
      { id: "d", type: "remove" },
      {
        bookmark: { id: "d2", order: 5, title: "D", url: "https://d.example/" },
        type: "add",
      },
    ]);

    expect(undo(after, bookmarkChangesBetween(STATE, after)).state).toEqual(
      STATE,
    );
  });
});

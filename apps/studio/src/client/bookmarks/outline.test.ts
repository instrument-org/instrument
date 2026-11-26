import {
  applyBookmarkOps,
  barItems,
  type Bookmark,
  type BookmarkFolder,
  type Bookmarks,
  OTHER_ROOT,
  rootItems,
  type BarItem,
} from "@/shared/bookmarks";
import { describe, expect, it } from "vitest";

import {
  clipOf,
  dropTargetAt,
  moveOps,
  NOTHING_SELECTED,
  type OutlineRow,
  outlineRows,
  pasteOps,
  pastePlace,
  restoreOps,
  selectionAfterClick,
  sortByNameOps,
  topmostPicked,
} from "./outline";

const page = (
  id: string,
  order: number,
  title: string,
  folder?: string,
): Bookmark => ({
  id,
  order,
  title,
  url: `https://${id}.example/`,
  ...(folder === undefined ? {} : { folder }),
});
const folder = (id: string, order: number, title: string): BookmarkFolder => ({
  id,
  order,
  title,
});

// The bar: Zendesk, Competitors [Intercom, Freshdesk], Help Scout, Reading [G2].
const state: Bookmarks = {
  bookmarks: [
    page("zendesk", 0, "Zendesk pricing"),
    page("intercom", 0, "Intercom pricing", "competitors"),
    page("freshdesk", 1, "Freshdesk plans", "competitors"),
    page("helpscout", 2, "Help Scout"),
    page("g2", 0, "G2 help desk grid", "reading"),
  ],
  folders: [
    folder("competitors", 1, "Competitors"),
    folder("reading", 3, "Reading"),
  ],
};

const listed = (rows: readonly OutlineRow[]) =>
  rows.map((row) =>
    row.kind === "bookmark"
      ? `${"  ".repeat(row.depth)}${row.bookmark.title}`
      : `${"  ".repeat(row.depth)}${row.isOpen ? "▾" : "▸"} ${row.kind === "root" ? "All Bookmarks" : row.folder.title} (${row.count.toString()})`,
  );

/** Items as one line each, what is in a folder in brackets. */
const drawnItems = (items: readonly BarItem[]): string[] =>
  items.map((item) =>
    item.kind === "folder"
      ? `${item.folder.title} [${drawnItems(item.items).join(", ")}]`
      : item.bookmark.title,
  );

/** The bar as one line per item. */
const drawn = (bookmarks: Bookmarks) => drawnItems(barItems(bookmarks));

describe("outlineRows", () => {
  it("lists the bar's items in order, with an open folder's bookmarks under it", () => {
    expect(
      listed(outlineRows(state, { open: new Set(["competitors"]), q: "" })),
    ).toEqual([
      "Zendesk pricing",
      "▾ Competitors (2)",
      "  Intercom pricing",
      "  Freshdesk plans",
      "Help Scout",
      "▸ Reading (1)",
    ]);
  });

  it("searches every folder at once, by every word in a name or an address", () => {
    expect(
      listed(outlineRows(state, { open: new Set(), q: "PRICING inter" })),
    ).toEqual(["  Intercom pricing"]);
    expect(
      listed(outlineRows(state, { open: new Set(), q: "g2.example" })),
    ).toEqual(["  G2 help desk grid"]);
    expect(listed(outlineRows(state, { open: new Set(), q: "read" }))).toEqual([
      "▸ Reading (1)",
    ]);
  });
});

describe("selectionAfterClick", () => {
  const order = ["a", "b", "c", "d"];
  it("picks a row alone, adds one with ⌘, and a range with Shift", () => {
    const one = selectionAfterClick(NOTHING_SELECTED, order, "b", {});
    expect([...one.ids]).toEqual(["b"]);
    const two = selectionAfterClick(one, order, "d", { toggle: true });
    expect([...two.ids]).toEqual(["b", "d"]);
    const back = selectionAfterClick(two, order, "b", { toggle: true });
    expect([...back.ids]).toEqual(["d"]);
    const range = selectionAfterClick(one, order, "d", { extend: true });
    expect([...range.ids]).toEqual(["b", "c", "d"]);
    // The range keeps reaching from the row first clicked.
    const shorter = selectionAfterClick(range, order, "a", { extend: true });
    expect([...shorter.ids]).toEqual(["a", "b"]);
  });
});

describe("delete and undo", () => {
  it("acts on a picked folder whole, and puts it back with what was in it", () => {
    const picked = topmostPicked(
      state,
      new Set(["competitors", "intercom", "helpscout"]),
    );
    expect(picked.bookmarks.map((each) => each.id)).toEqual(["helpscout"]);
    expect(picked.folders.map((each) => each.id)).toEqual(["competitors"]);
    const removed = applyBookmarkOps(state, [
      { id: "competitors", type: "remove" },
      { id: "helpscout", type: "remove" },
    ]);
    expect(applyBookmarkOps(removed, restoreOps(state, picked))).toEqual(
      applyBookmarkOps(state, []),
    );
  });
});

describe("paste", () => {
  let next = 0;
  const newId = () => `new${(next++).toString()}`;
  const rows = outlineRows(state, { open: new Set(["competitors"]), q: "" });
  const row = (id: string) => rows.find((each) => each.id === id);

  it("pastes bookmarks right after the row it is asked over, in its folder", () => {
    const clip = clipOf(state, rows, new Set(["zendesk", "helpscout"]));
    const place = pastePlace(state, row("intercom"));
    expect(drawn(applyBookmarkOps(state, pasteOps(state, clip, place, newId))))
      .toMatchInlineSnapshot(`
        [
          "Zendesk pricing",
          "Competitors [Intercom pricing, Zendesk pricing, Help Scout, Freshdesk plans]",
          "Help Scout",
          "Reading [G2 help desk grid]",
        ]
      `);
  });

  it("pastes a folder with its bookmarks into the folder it was asked inside", () => {
    const clip = clipOf(state, rows, new Set(["competitors", "intercom"]));
    expect(clip).toHaveLength(1);
    const place = pastePlace(state, row("freshdesk"));
    expect(drawn(applyBookmarkOps(state, pasteOps(state, clip, place, newId))))
      .toMatchInlineSnapshot(`
        [
          "Zendesk pricing",
          "Competitors [Intercom pricing, Freshdesk plans, Competitors [Intercom pricing, Freshdesk plans]]",
          "Help Scout",
          "Reading [G2 help desk grid]",
        ]
      `);
  });
});

describe("drag", () => {
  const rows = outlineRows(state, { open: new Set(["competitors"]), q: "" });
  const at = (id: string) => rows.findIndex((row) => row.id === id);
  const drop = (ids: string[], over: string, fraction: number) => {
    const target = dropTargetAt(state, rows, at(over), fraction, new Set(ids));
    if (!target) {
      return undefined;
    }
    return drawn(applyBookmarkOps(state, moveOps(state, ids, target.place)));
  };

  it("files a bookmark let go on a folder's middle at its end", () => {
    expect(drop(["zendesk"], "reading", 0.5)).toEqual([
      "Competitors [Intercom pricing, Freshdesk plans]",
      "Help Scout",
      "Reading [G2 help desk grid, Zendesk pricing]",
    ]);
  });

  it("places rows before or after a bookmark by its halves, in or out of folders", () => {
    expect(drop(["helpscout"], "freshdesk", 0.2)).toEqual([
      "Zendesk pricing",
      "Competitors [Intercom pricing, Help Scout, Freshdesk plans]",
      "Reading [G2 help desk grid]",
    ]);
    expect(drop(["intercom", "freshdesk"], "helpscout", 0.9)).toEqual([
      "Zendesk pricing",
      "Competitors []",
      "Help Scout",
      "Intercom pricing",
      "Freshdesk plans",
      "Reading [G2 help desk grid]",
    ]);
  });

  it("moves a folder along the bar, and into another folder", () => {
    expect(drop(["reading"], "zendesk", 0.1)).toEqual([
      "Reading [G2 help desk grid]",
      "Zendesk pricing",
      "Competitors [Intercom pricing, Freshdesk plans]",
      "Help Scout",
    ]);
    expect(drop(["reading"], "competitors", 0.5)).toEqual([
      "Zendesk pricing",
      "Competitors [Intercom pricing, Freshdesk plans, Reading [G2 help desk grid]]",
      "Help Scout",
    ]);
    expect(drop(["reading"], "intercom", 0.6)).toEqual([
      "Zendesk pricing",
      "Competitors [Intercom pricing, Reading [G2 help desk grid], Freshdesk plans]",
      "Help Scout",
    ]);
  });

  it("has nowhere to land inside a folder that is held", () => {
    expect(drop(["competitors"], "intercom", 0.5)).toBeUndefined();
  });

  it("files a bookmark first in an open folder when let go on its bottom quarter", () => {
    expect(drop(["helpscout"], "competitors", 0.9)).toEqual([
      "Zendesk pricing",
      "Competitors [Help Scout, Intercom pricing, Freshdesk plans]",
      "Reading [G2 help desk grid]",
    ]);
  });

  it("has nowhere to land over a row that is held", () => {
    expect(drop(["zendesk"], "zendesk", 0.5)).toBeUndefined();
  });
});

describe("sortByNameOps", () => {
  it("puts folders first, then bookmarks, each by name, and each folder's contents by name", () => {
    expect(drawn(applyBookmarkOps(state, sortByNameOps(state, "en"))))
      .toMatchInlineSnapshot(`
        [
          "Competitors [Freshdesk plans, Intercom pricing]",
          "Reading [G2 help desk grid]",
          "Help Scout",
          "Zendesk pricing",
        ]
      `);
  });
});

describe("All Bookmarks", () => {
  // The bar above, and All Bookmarks: Trips [Notes], Wiki.
  const withOther: Bookmarks = {
    bookmarks: [
      ...state.bookmarks,
      page("notes", 0, "Notes", "trips"),
      { ...page("wiki", 1, "Wiki"), root: OTHER_ROOT },
    ],
    folders: [
      ...state.folders,
      { ...folder("trips", 0, "Trips"), root: OTHER_ROOT },
    ],
  };
  const rows = outlineRows(withOther, {
    open: new Set([OTHER_ROOT, "trips"]),
    q: "",
  });
  const at = (id: string) => rows.findIndex((row) => row.id === id);
  /** All Bookmarks as one line per item, a folder's contents in brackets. */
  const other = (bookmarks: Bookmarks) =>
    drawnItems(rootItems(bookmarks, OTHER_ROOT));
  const drop = (ids: string[], over: string, fraction: number) => {
    const target = dropTargetAt(
      withOther,
      rows,
      at(over),
      fraction,
      new Set(ids),
    );
    if (!target) {
      return undefined;
    }
    const after = applyBookmarkOps(
      withOther,
      moveOps(withOther, ids, target.place),
    );
    return { bar: drawn(after), other: other(after) };
  };

  it("lists All Bookmarks after the bar, its items a step in", () => {
    expect(listed(rows).slice(-4)).toEqual([
      "▾ All Bookmarks (2)",
      "  ▾ Trips (1)",
      "    Notes",
      "  Wiki",
    ]);
    expect(
      listed(outlineRows(state, { open: new Set([OTHER_ROOT]), q: "" })),
    ).not.toContain("▾ All Bookmarks (0)");
  });

  it("searches All Bookmarks with the bar", () => {
    expect(
      outlineRows(withOther, { open: new Set(), q: "wiki" }).map((row) =>
        row.kind === "bookmark" ? row.root : undefined,
      ),
    ).toEqual([OTHER_ROOT]);
  });

  it("files a bookmark let go on All Bookmarks loose at its end", () => {
    expect(drop(["zendesk"], OTHER_ROOT, 0.5)?.other).toEqual([
      "Trips [Notes]",
      "Wiki",
      "Zendesk pricing",
    ]);
    expect(drop(["wiki"], "zendesk", 0.25)?.bar[0]).toBe("Wiki");
  });

  it("moves a folder between the roots", () => {
    expect(drop(["reading"], OTHER_ROOT, 0.5)?.other).toEqual([
      "Trips [Notes]",
      "Wiki",
      "Reading [G2 help desk grid]",
    ]);
    expect(drop(["trips"], "wiki", 0.9)?.other).toEqual([
      "Wiki",
      "Trips [Notes]",
    ]);
  });

  it("pastes into All Bookmarks asked over its row", () => {
    const root = rows.find((row) => row.kind === "root");
    const place = pastePlace(withOther, root);
    const pasted = applyBookmarkOps(
      withOther,
      pasteOps(
        withOther,
        [{ items: [], kind: "folder", title: "Kept" }],
        place,
        () => "kept",
      ),
    );
    expect(other(pasted)).toEqual(["Trips [Notes]", "Wiki", "Kept []"]);
  });

  it("sorts All Bookmarks by name too", () => {
    const unsorted: Bookmarks = {
      ...withOther,
      bookmarks: [
        { ...page("zeta", 0, "Zeta"), root: OTHER_ROOT },
        ...withOther.bookmarks,
      ],
    };
    const sorted = applyBookmarkOps(unsorted, sortByNameOps(unsorted, "en"));
    expect(other(sorted)).toEqual(["Trips [Notes]", "Wiki", "Zeta"]);
  });
});

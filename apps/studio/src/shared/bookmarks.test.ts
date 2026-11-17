import { describe, expect, it } from "vitest";

import {
  applyBookmarkOps,
  type BarItem,
  type Bookmark,
  type BookmarkFolder,
  type Bookmarks,
  barItems,
  bookmarkPlaces,
  folderOf,
  inOrder,
  keyOfPlace,
  orderAfter,
  orderOnBar,
  OTHER_ROOT,
  placeOfKey,
  rootItems,
  rootOf,
  siblingsIn,
} from "./bookmarks";

const page = (id: string, order: number, folder?: string): Bookmark => ({
  id,
  order,
  title: `Page ${id}`,
  url: `https://example.com/${id}`,
  ...(folder === undefined ? {} : { folder }),
});

const folder = (id: string, order: number): BookmarkFolder => ({
  id,
  order,
  title: `Folder ${id}`,
});

const of = (
  bookmarks: Bookmark[],
  folders: BookmarkFolder[] = [],
): Bookmarks => ({ bookmarks, folders });

/** The bar as one line per item, a folder's contents in brackets. */
function drawn(items: readonly BarItem[]): string[] {
  return items.map((item) =>
    item.kind === "folder"
      ? `${item.folder.id} [${item.items.map((each) => each.id).join(" ")}]`
      : item.bookmark.id,
  );
}

describe("applyBookmarkOps", () => {
  it("adds, renames, moves and removes, answering them in order", () => {
    const state = of([page("a", 0), page("b", 1)]);
    expect(
      applyBookmarkOps(state, [
        { bookmark: page("c", orderAfter(state.bookmarks)), type: "add" },
        { id: "a", title: "Docs", type: "rename" },
        { id: "c", order: -1, type: "move" },
        { id: "b", type: "remove" },
      ]).bookmarks.map(({ id, title }) => `${id} ${title}`),
    ).toEqual(["c Page c", "a Docs"]);
  });

  it("keeps the bookmark already there when an add names its id", () => {
    expect(
      applyBookmarkOps(of([page("a", 0)]), [
        { bookmark: { ...page("a", 5), title: "Other" }, type: "add" },
      ]),
    ).toEqual(of([page("a", 0)]));
  });

  it("leaves the rest alone for an op naming a bookmark that is gone", () => {
    expect(
      applyBookmarkOps(of([page("a", 0)]), [
        { id: "x", title: "Nope", type: "rename" },
        { id: "x", type: "remove" },
        { id: "x", order: 3, type: "move" },
      ]),
    ).toEqual(of([page("a", 0)]));
  });

  it("makes, renames and moves a folder, and files bookmarks in and out of it", () => {
    const state = applyBookmarkOps(of([page("a", 0), page("b", 1)]), [
      { folder: folder("f", 2), type: "addFolder" },
      { id: "f", title: "Work", type: "rename" },
      { folder: "f", id: "a", order: 0, type: "move" },
      { folder: "f", id: "b", order: -1, type: "move" },
      { id: "f", order: -5, type: "move" },
    ]);
    expect(drawn(barItems(state))).toEqual(["f [b a]"]);
    expect(state.folders).toEqual([{ id: "f", order: -5, title: "Work" }]);
    const out = applyBookmarkOps(state, [{ id: "a", order: 9, type: "move" }]);
    expect(drawn(barItems(out))).toEqual(["f [b]", "a"]);
    expect(out.bookmarks.find((each) => each.id === "a")).toEqual(page("a", 9));
  });

  it("reorders within a folder without taking anything out of it", () => {
    const state = of(
      [page("a", 0, "f"), page("b", 1, "f"), page("c", 2, "f")],
      [folder("f", 0)],
    );
    expect(
      drawn(
        barItems(
          applyBookmarkOps(state, [
            { folder: "f", id: "c", order: 0.5, type: "move" },
          ]),
        ),
      ),
    ).toEqual(["f [a c b]"]);
  });

  it("removes a folder with everything filed in it, and leaves the rest", () => {
    const state = of(
      [page("a", 0, "f"), page("b", 1, "f"), page("c", 2), page("d", 0, "g")],
      [folder("f", 0), folder("g", 1)],
    );
    expect(
      drawn(barItems(applyBookmarkOps(state, [{ id: "f", type: "remove" }]))),
    ).toEqual(["g [d]", "c"]);
  });

  it("puts a removed folder back with its bookmarks in their places, as Undo does", () => {
    const state = of(
      [page("a", 0, "f"), page("b", 1, "f"), page("c", 2)],
      [folder("f", 1)],
    );
    const removed = applyBookmarkOps(state, [{ id: "f", type: "remove" }]);
    const undone = applyBookmarkOps(removed, [
      { folder: folder("f", 1), type: "addFolder" },
      { bookmark: page("a", 0, "f"), type: "add" },
      { bookmark: page("b", 1, "f"), type: "add" },
    ]);
    expect(undone).toEqual(state);
  });

  it("files a bookmark moved or added into a folder that is not there on the bar", () => {
    const state = applyBookmarkOps(of([page("a", 0)]), [
      { folder: "gone", id: "a", order: 1, type: "move" },
      { bookmark: page("b", 2, "gone"), type: "add" },
    ]);
    expect(state.bookmarks).toEqual([page("a", 1), page("b", 2)]);
  });

  it("never files a folder in a folder", () => {
    const state = applyBookmarkOps(of([], [folder("f", 0), folder("g", 1)]), [
      { folder: "g", id: "f", order: 4, type: "move" },
    ]);
    expect(state.folders).toEqual([folder("g", 1), folder("f", 4)]);
    expect(drawn(barItems(state))).toEqual(["g []", "f []"]);
  });

  it("keeps a bookmark at a new address in its place, and leaves a folder or an empty address alone", () => {
    const state = of([page("a", 0, "f"), page("b", 1)], [folder("f", 2)]);
    const next = applyBookmarkOps(state, [
      { id: "a", type: "setUrl", url: "https://example.org/moved" },
      { id: "b", type: "setUrl", url: "" },
      { id: "f", type: "setUrl", url: "https://example.org/folder" },
    ]);
    expect(next).toEqual(
      of(
        [
          { ...page("a", 0, "f"), url: "https://example.org/moved" },
          page("b", 1),
        ],
        [folder("f", 2)],
      ),
    );
  });

  it("refuses a folder whose id a bookmark has, and the other way round", () => {
    const state = of([page("a", 0)], [folder("f", 1)]);
    expect(
      applyBookmarkOps(state, [
        { folder: folder("a", 3), type: "addFolder" },
        { bookmark: page("f", 4), type: "add" },
      ]),
    ).toEqual(state);
  });
});

describe("barItems", () => {
  it("sorts bookmarks and folders on the bar together, each folder with its own in order", () => {
    expect(
      drawn(
        barItems(
          of(
            [page("a", 2), page("b", 1, "f"), page("c", 0, "f"), page("d", 0)],
            [folder("f", 1)],
          ),
        ),
      ),
    ).toEqual(["d", "f [c b]", "a"]);
  });

  it("shows a bookmark whose folder is gone on the bar, never nowhere", () => {
    const state = of([page("a", 0, "gone"), page("b", 1)], []);
    expect(drawn(barItems(state))).toEqual(["a", "b"]);
    expect(folderOf(state, page("a", 0, "gone"))).toBeUndefined();
  });

  it("shows a bookmark naming itself, or another bookmark, as its folder on the bar", () => {
    expect(
      drawn(barItems(of([page("a", 0, "a"), page("b", 1, "a")], []))),
    ).toEqual(["a", "b"]);
  });

  it("draws every bookmark exactly once however the folders are named", () => {
    const bookmarks = Array.from({ length: 40 }, (_, at) =>
      page(`b${at.toString()}`, at % 7, ["f", "g", "a1", undefined][at % 4]),
    );
    const items = barItems(of(bookmarks, [folder("f", 3), folder("g", 0)]));
    const ids = items.flatMap((item) =>
      item.kind === "folder"
        ? item.items.map((each) => each.id)
        : [item.bookmark.id],
    );
    expect(ids.toSorted()).toEqual(bookmarks.map((each) => each.id).toSorted());
  });
});

describe("orders", () => {
  it("places something new on the bar after its bookmarks and folders, whatever is in the folders", () => {
    const state = of([page("a", 0), page("b", 50, "f")], [folder("f", 3)]);
    expect(orderOnBar(state)).toBe(4);
    expect(siblingsIn(state, "f").map((each) => each.id)).toEqual(["b"]);
    expect(siblingsIn(state, undefined).map((each) => each.id)).toEqual([
      "a",
      "f",
    ]);
  });

  it("sorts ties by id, so every device lists them alike", () => {
    expect(
      inOrder([page("b", 1), page("a", 1), page("c", 0)]).map((b) => b.id),
    ).toEqual(["c", "a", "b"]);
  });
});

describe("All Bookmarks", () => {
  const other = (id: string, order: number): Bookmark => ({
    ...page(id, order),
    root: OTHER_ROOT,
  });
  const otherFolder = (id: string, order: number): BookmarkFolder => ({
    ...folder(id, order),
    root: OTHER_ROOT,
  });
  const state = of(
    [page("a", 0), other("o", 1), page("in", 0, "of"), page("bf", 0, "f")],
    [folder("f", 1), otherFolder("of", 0)],
  );

  it("keeps the bar and All Bookmarks apart, each folder in its own root", () => {
    expect(drawn(barItems(state))).toEqual(["a", "f [bf]"]);
    expect(drawn(rootItems(state, OTHER_ROOT))).toEqual(["of [in]", "o"]);
    expect(
      state.bookmarks.map((each) => `${each.id} ${rootOf(state, each) ?? ""}`),
    ).toEqual(["a ", "o other", "in other", "bf "]);
  });

  it("moves a bookmark between the roots, and a folder only within its own", () => {
    const moved = applyBookmarkOps(state, [
      { id: "a", order: 5, root: OTHER_ROOT, type: "move" },
      { id: "o", order: 5, type: "move" },
      { id: "of", order: 9, type: "move" },
    ]);
    expect(drawn(barItems(moved))).toEqual(["f [bf]", "o"]);
    expect(drawn(rootItems(moved, OTHER_ROOT))).toEqual(["a", "of [in]"]);
  });

  it("lists every place a bookmark can go, the bar's first", () => {
    expect(
      bookmarkPlaces(state).map(
        ({ depth, key, title }) => `${"  ".repeat(depth)}${key ?? ""} ${title}`,
      ),
    ).toEqual([
      " Bookmarks bar",
      "  f Folder f",
      "other All Bookmarks",
      "  of Folder of",
    ]);
    expect(placeOfKey(keyOfPlace({ root: OTHER_ROOT }))).toEqual({
      root: OTHER_ROOT,
    });
  });
});

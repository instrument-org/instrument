import {
  applyBookmarkOps,
  barItems,
  type Bookmark,
  type BookmarkFolder,
  type Bookmarks,
} from "@/shared/bookmarks";
import { describe, expect, it } from "vitest";

import { addressOfTyped, bookmarkEditOps, newBookmarkPlace } from "./edit";

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
const state: Bookmarks = {
  bookmarks: [page("a", 0), page("b", 0, "f"), page("c", 1, "f")],
  folders: [folder("f", 1)],
};

/** The bar as one line per item, a folder's contents in brackets. */
const drawn = (bookmarks: Bookmarks) =>
  barItems(bookmarks).map((item) =>
    item.kind === "folder"
      ? `${item.folder.title} [${item.items.map((each) => each.title).join(", ")}]`
      : item.bookmark.title,
  );

describe("addressOfTyped", () => {
  it.each([
    ["https://example.com/a", "https://example.com/a"],
    ["  example.com/docs ", "https://example.com/docs"],
    ["file:///Users/mac-user/notes.md", "file:///Users/mac-user/notes.md"],
    ["instrument://chat/one", "instrument://chat/one"],
    ["not an address", undefined],
    ["", undefined],
  ])("reads %j as %j", (typed, address) => {
    expect(addressOfTyped(typed)).toBe(address);
  });
});

describe("bookmarkEditOps", () => {
  it("changes only what was edited", () => {
    const a = page("a", 0);
    expect(
      bookmarkEditOps(state, a, {
        folder: undefined,
        newFolders: [],
        title: " Docs ",
        url: a.url,
      }),
    ).toEqual([{ id: "a", title: "Docs", type: "rename" }]);
    expect(
      bookmarkEditOps(state, a, {
        folder: undefined,
        newFolders: [],
        title: a.title,
        url: a.url,
      }),
    ).toEqual([]);
  });

  it("readdresses a bookmark and files it last in the folder picked", () => {
    const a = page("a", 0);
    const next = applyBookmarkOps(
      state,
      bookmarkEditOps(state, a, {
        folder: "f",
        newFolders: [],
        title: a.title,
        url: "https://example.org/",
      }),
    );
    expect(drawn(next)).toEqual(["Folder f [Page b, Page c, Page a]"]);
    expect(next.bookmarks.find((each) => each.id === "a")?.url).toBe(
      "https://example.org/",
    );
  });

  it("makes the folders New folder made, at the bar's end, and files the bookmark in the one picked", () => {
    const b = page("b", 0, "f");
    const next = applyBookmarkOps(
      state,
      bookmarkEditOps(state, b, {
        folder: "new",
        newFolders: [
          { id: "new", order: 0, title: "Reading" },
          { id: "blank", order: 0, title: "  " },
        ],
        title: b.title,
        url: b.url,
      }),
    );
    expect(drawn(next)).toEqual([
      "Page a",
      "Folder f [Page c]",
      "Reading [Page b]",
      "New folder []",
    ]);
  });

  it("adds a bookmark not kept yet where it was filed", () => {
    const fresh = page("d", 0);
    expect(
      drawn(
        applyBookmarkOps(
          state,
          bookmarkEditOps(state, fresh, {
            folder: undefined,
            newFolders: [],
            title: "Fresh",
            url: fresh.url,
          }),
        ),
      ),
    ).toEqual(["Page a", "Folder f [Page b, Page c]", "Fresh"]);
  });
});

describe("newBookmarkPlace", () => {
  it("files a new bookmark last in the folder picked last while it is there, and on the bar otherwise", () => {
    expect(newBookmarkPlace(state, "f")).toEqual({ folder: "f", order: 2 });
    expect(newBookmarkPlace(state, "gone")).toEqual({ order: 2 });
    expect(newBookmarkPlace(state, null)).toEqual({ order: 2 });
  });
});

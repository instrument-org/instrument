import {
  applyBookmarkOps,
  barItems,
  type Bookmark,
  type BookmarkFolder,
  type Bookmarks,
  OTHER_ROOT,
  rootItems,
  bookmarksIn,
} from "@/shared/bookmarks";
import { describe, expect, it } from "vitest";

import {
  addressOfTyped,
  bookmarkEditOps,
  newBookmarkPlace,
  removeChatBookmarkOps,
} from "./edit";

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
      ? `${item.folder.title} [${bookmarksIn(item.items)
          .map((each) => each.title)
          .join(", ")}]`
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

  it("makes a folder New folder made in a folder, in it, and files the bookmark there", () => {
    const a = page("a", 0);
    const next = applyBookmarkOps(
      state,
      bookmarkEditOps(state, a, {
        folder: "inner",
        newFolders: [{ folder: "f", id: "inner", order: 0, title: "Inner" }],
        title: a.title,
        url: a.url,
      }),
    );
    expect(next.folders.find((each) => each.id === "inner")).toEqual({
      folder: "f",
      id: "inner",
      order: 2,
      title: "Inner",
    });
    expect(next.bookmarks.find((each) => each.id === "a")?.folder).toBe(
      "inner",
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
  it("files a new bookmark last in the place picked last while it is there, and in All Bookmarks otherwise", () => {
    expect(newBookmarkPlace(state, "f")).toEqual({ folder: "f", order: 2 });
    expect(newBookmarkPlace(state, "gone")).toEqual({
      order: 0,
      root: OTHER_ROOT,
    });
    expect(newBookmarkPlace(state, null)).toEqual({ order: 2 });
    expect(newBookmarkPlace(state, OTHER_ROOT)).toEqual({
      order: 0,
      root: OTHER_ROOT,
    });
  });
});

describe("bookmarkEditOps with All Bookmarks", () => {
  it("moves a bookmark loose into All Bookmarks and back onto the bar", () => {
    const edit = (to: string | undefined, from: Bookmarks = state) => {
      const a = from.bookmarks.find((each) => each.id === "a");
      return a
        ? applyBookmarkOps(
            from,
            bookmarkEditOps(from, a, {
              folder: to,
              newFolders: [],
              title: a.title,
              url: a.url,
            }),
          )
        : from;
    };
    const moved = edit(OTHER_ROOT);
    expect(drawn(moved)).toEqual(["Folder f [Page b, Page c]"]);
    expect(rootItems(moved, OTHER_ROOT).map((item) => item.kind)).toEqual([
      "bookmark",
    ]);
    expect(drawn(edit(undefined, moved))).toEqual([
      "Folder f [Page b, Page c]",
      "Page a",
    ]);
  });
});

describe("removeChatBookmarkOps", () => {
  it("takes away every bookmark of the chat, however its address is spelled, and nothing else", () => {
    const kept: Bookmarks = {
      bookmarks: [
        { ...page("one", 2), url: "instrument://chat/trip" },
        { ...page("two", 3, "f"), url: "Instrument://Chat/trip" },
        { ...page("other", 4), url: "instrument://chat/groceries" },
        page("a", 0),
      ],
      folders: [folder("f", 1)],
    };
    expect(removeChatBookmarkOps(kept, "trip")).toEqual([
      { id: "one", type: "remove" },
      { id: "two", type: "remove" },
    ]);
  });
});

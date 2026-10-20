import { describe, expect, it } from "vitest";

import {
  applyBookmarkOps,
  type Bookmark,
  inOrder,
  orderAfter,
} from "./bookmarks";

const page = (id: string, order: number): Bookmark => ({
  id,
  order,
  title: `Page ${id}`,
  url: `https://example.com/${id}`,
});

describe("applyBookmarkOps", () => {
  it("adds, renames, moves and removes, answering them in order", () => {
    const bookmarks = [page("a", 0), page("b", 1)];
    expect(
      applyBookmarkOps(bookmarks, [
        { bookmark: page("c", orderAfter(bookmarks)), type: "add" },
        { id: "a", title: "Docs", type: "rename" },
        { id: "c", order: -1, type: "move" },
        { id: "b", type: "remove" },
      ]).map(({ id, title }) => `${id} ${title}`),
    ).toEqual(["c Page c", "a Docs"]);
  });

  it("keeps the bookmark already there when an add names its id", () => {
    expect(
      applyBookmarkOps(
        [page("a", 0)],
        [{ bookmark: { ...page("a", 5), title: "Other" }, type: "add" }],
      ),
    ).toEqual([page("a", 0)]);
  });

  it("leaves the rest alone for an op naming a bookmark that is gone", () => {
    expect(
      applyBookmarkOps(
        [page("a", 0)],
        [
          { id: "x", title: "Nope", type: "rename" },
          { id: "x", type: "remove" },
        ],
      ),
    ).toEqual([page("a", 0)]);
  });
});

it("sorts ties by id, so every device lists them alike", () => {
  expect(
    inOrder([page("b", 1), page("a", 1), page("c", 0)]).map((b) => b.id),
  ).toEqual(["c", "a", "b"]);
});

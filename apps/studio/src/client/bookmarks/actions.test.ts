import { OTHER_ROOT } from "@/shared/bookmarks";
import { describe, expect, it } from "vitest";

import { bookmarkListing } from "./actions";

describe("bookmarkListing", () => {
  it("lists the bar, then Other bookmarks, each folder before what is filed in it", () => {
    expect(
      bookmarkListing({
        bookmarks: [
          { id: "a", order: 0, title: "A", url: "https://a.example/" },
          {
            folder: "f",
            id: "b",
            order: 0,
            title: "B",
            url: "https://b.example/",
          },
          {
            id: "c",
            order: 0,
            root: OTHER_ROOT,
            title: "C",
            url: "https://c.example/",
          },
          {
            folder: "other-files",
            id: "d",
            order: 0,
            title: "plan.md",
            url: "file:///Users/mac-user/plan.md",
          },
        ],
        folders: [
          { id: "f", order: 1, title: "Work" },
          { id: "other-files", order: 1, root: OTHER_ROOT, title: "Files" },
        ],
      }),
    ).toEqual([
      { kind: "bookmark", root: "bar", title: "A", url: "https://a.example/" },
      { kind: "folder", root: "bar", title: "Work" },
      {
        folder: "Work",
        kind: "bookmark",
        root: "bar",
        title: "B",
        url: "https://b.example/",
      },
      {
        kind: "bookmark",
        root: "other",
        title: "C",
        url: "https://c.example/",
      },
      { kind: "folder", root: "other", title: "Files" },
      {
        folder: "Files",
        kind: "bookmark",
        root: "other",
        title: "plan.md",
        url: "file:///Users/mac-user/plan.md",
      },
    ]);
  });
});

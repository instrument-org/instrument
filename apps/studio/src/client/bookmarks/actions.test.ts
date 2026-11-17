import { OTHER_ROOT } from "@/shared/bookmarks";
import { describe, expect, it } from "vitest";

import { bookmarkListing } from "./actions";

describe("bookmarkListing", () => {
  it("lists the bar, then All Bookmarks, each folder before what is filed in it", () => {
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
            folder: "trips",
            id: "d",
            order: 0,
            title: "plan.md",
            url: "file:///Users/mac-user/plan.md",
          },
        ],
        folders: [
          { id: "f", order: 1, title: "Work" },
          { id: "trips", order: 1, root: OTHER_ROOT, title: "Trips" },
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
        root: "all",
        title: "C",
        url: "https://c.example/",
      },
      { kind: "folder", root: "all", title: "Trips" },
      {
        folder: "Trips",
        kind: "bookmark",
        root: "all",
        title: "plan.md",
        url: "file:///Users/mac-user/plan.md",
      },
    ]);
  });
});

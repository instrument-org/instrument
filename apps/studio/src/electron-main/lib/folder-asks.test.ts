import { describe, expect, it } from "vitest";

import { folderAsks } from "./folder-asks";

describe("folderAsks", () => {
  const home = "/Users/mac-user";

  it("names the folders macOS asks about under a walk from home", () => {
    expect(
      folderAsks({
        home,
        known: new Map([
          ["/Users/mac-user/Documents", "allowed"],
          ["/Users/mac-user/Desktop", "refused"],
        ]),
        notSearched: [],
        platform: "darwin",
        root: home,
      }),
    ).toEqual([
      { name: "Desktop", path: "/Users/mac-user/Desktop", refused: true },
      { name: "Downloads", path: "/Users/mac-user/Downloads" },
      {
        name: "iCloud Drive",
        path: "/Users/mac-user/Library/Mobile Documents/com~apple~CloudDocs",
      },
    ]);
  });

  it("names none for a walk inside one of them", () => {
    expect(
      folderAsks({
        home,
        known: new Map(),
        notSearched: [],
        platform: "darwin",
        root: "/Users/mac-user/Documents",
      }),
    ).toEqual([]);
  });

  it("offers AppData on Windows as a folder to search in", () => {
    expect(
      folderAsks({
        home: String.raw`C:\Users\windows-user`,
        known: new Map(),
        notSearched: [String.raw`C:\Users\windows-user\AppData`],
        platform: "win32",
        root: String.raw`C:\Users\windows-user`,
      }),
    ).toEqual([
      {
        name: "AppData",
        path: String.raw`C:\Users\windows-user\AppData`,
        searchIn: true,
      },
    ]);
  });
});

import { describe, expect, it } from "vitest";

import { gtkBookmarkFolders } from "./system-sidebar";

describe("gtkBookmarkFolders", () => {
  it("reads the local folders, labeled or not, and skips other addresses", () => {
    expect(
      gtkBookmarkFolders(
        [
          "file:///home/casey/code",
          "file:///home/casey/My%20Notes Notes",
          "sftp://server/home/casey",
          "",
        ].join("\n"),
      ),
    ).toEqual(["/home/casey/code", "/home/casey/My Notes"]);
  });
});

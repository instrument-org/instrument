import { describe, expect, it } from "vitest";

import { gtkBookmarkFolders, quickAccessFolders } from "./system-sidebar";

describe("quickAccessFolders", () => {
  it.each([
    [
      '["C:\\\\Users\\\\windows-user\\\\Desktop","D:\\\\Work"]',
      ["C:\\Users\\windows-user\\Desktop", "D:\\Work"],
    ],
    [
      '"C:\\\\Users\\\\windows-user\\\\Desktop"\r\n',
      ["C:\\Users\\windows-user\\Desktop"],
    ],
    ["[]", []],
    ["", []],
  ])("reads %j", (stdout, folders) => {
    expect(quickAccessFolders(stdout)).toEqual(folders);
  });
});

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

import { describe, expect, it } from "vitest";

import { isBorrowedPath, splitTransferItems } from "./transfer-items";

function item({
  isDirectory = false,
  kind = "file",
  name,
  type = "",
}: {
  isDirectory?: boolean;
  kind?: "file" | "string";
  name: string;
  type?: string;
}) {
  const file = new File([], name, { type });
  return {
    getAsFile: () => (kind === "file" ? file : null),
    kind,
    type,
    webkitGetAsEntry: () => (kind === "file" ? { isDirectory } : null),
  };
}

const getFilePath = (file: File) => `/Users/me/${file.name}`;

describe("splitTransferItems", () => {
  it("sends a folder to the folders and a file to the files", () => {
    const { files, folders, unresolvedFolders } = splitTransferItems({
      getFilePath,
      items: [
        item({ isDirectory: true, name: "941" }),
        item({ name: "notes.txt", type: "text/plain" }),
        item({ kind: "string", name: "ignored", type: "text/plain" }),
      ],
    });

    expect(files.map((f) => f.name)).toEqual(["notes.txt"]);
    expect(folders).toEqual([{ path: "/Users/me/941", type: "folder" }]);
    expect(unresolvedFolders).toBe(0);
  });

  it("filters files only, never a folder", () => {
    const { files, folders } = splitTransferItems({
      getFilePath,
      items: [
        item({ isDirectory: true, name: "941" }),
        item({ name: "shot.png", type: "image/png" }),
      ],
      shouldAttachFile: () => false,
    });

    expect(files).toEqual([]);
    expect(folders).toEqual([{ path: "/Users/me/941", type: "folder" }]);
  });

  it("counts a folder whose path cannot be read", () => {
    const { folders, unresolvedFolders } = splitTransferItems({
      getFilePath: () => "",
      items: [item({ isDirectory: true, name: "941" })],
    });

    expect(folders).toEqual([]);
    expect(unresolvedFolders).toBe(1);
  });
});

describe("isBorrowedPath", () => {
  it.each([
    [
      "/var/folders/ab/cd/T/TemporaryItems/NSIRD_screencaptureui_12Wc6X/Screenshot 2026-11-12 at 4.58.13\u202fPM.png",
      true,
    ],
    [
      "/var/folders/ab/cd/T/TemporaryItems/NSIRD_screencaptureui_Ab12/Screen Recording.mov",
      true,
    ],
    ["/Users/mac-user/Desktop/Screenshot.png", false],
    ["/private/var/folders/ab/cd/T/Screenshot.png", true],
    [
      "/Users/mac-user/Library/Group Containers/group.com.apple.coreservices.useractivityd/shared-pasteboard/items/36B34172/IMG_0151.jpeg",
      true,
    ],
    [
      "/Users/mac-user/Library/Containers/com.example.shots/Data/tmp/com.example.shots/shot.png",
      true,
    ],
    ["/Users/mac-user/Library/Messages/Attachments/a/01/IMG_1.heic", true],
    [
      "/Users/mac-user/Pictures/Photos Library.photoslibrary/originals/1/a.jpeg",
      true,
    ],
    [String.raw`C:\Users\windows-user\AppData\Local\Temp\report.pdf`, true],
    [String.raw`C:\Users\windows-user\Documents\report.pdf`, false],
    [
      "/Users/mac-user/Library/Mobile Documents/com~apple~CloudDocs/a.pdf",
      false,
    ],
    ["/Users/mac-user/Library/CloudStorage/Dropbox/a.pdf", false],
    ["/Users/mac-user/Library/Application Support/Code/settings.json", false],
    ["/tmp/notes.md", false],
    ["", false],
  ])("%s → %s", (path, expected) => {
    expect(isBorrowedPath(path)).toBe(expected);
  });
});

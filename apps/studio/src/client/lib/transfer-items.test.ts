import { describe, expect, it } from "vitest";

import { splitTransferItems } from "./transfer-items";

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

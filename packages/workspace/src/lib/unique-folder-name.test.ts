import { describe, expect, it } from "vitest";

import { FolderAttachment } from "../schemas/folder-attachment";
import { AbsolutePathSchema } from "../schemas/paths";
import { uniqueFolderName } from "./unique-folder-name";

const makeFolders = (
  names: string[],
): Record<string, FolderAttachment.Type> => {
  const folders: Record<string, FolderAttachment.Type> = {};
  for (const [i, name] of names.entries()) {
    folders[name] = {
      createdAt: 0,
      id: FolderAttachment.IdSchema.parse(`folder-${i}`),
      name,
      path: AbsolutePathSchema.parse(`/taken/${name}`),
      source: "user",
    };
  }
  return folders;
};

describe("uniqueFolderName", () => {
  it("returns the basename when free", () => {
    expect(uniqueFolderName("/base/project/Downloads", makeFolders([])))
      .toMatchInlineSnapshot(`"Downloads"`);
  });

  it("qualifies with the parent dir name on a single collision", () => {
    expect(
      uniqueFolderName("/base/project/Downloads", makeFolders(["Downloads"])),
    ).toMatchInlineSnapshot(`"project-Downloads"`);
  });

  it("walks up further ancestors if the qualified name still collides", () => {
    expect(
      uniqueFolderName(
        "/base/project/Downloads",
        makeFolders(["Downloads", "project-Downloads"]),
      ),
    ).toMatchInlineSnapshot(`"base-project-Downloads"`);
  });

  it("falls back to a numeric suffix once ancestors run out", () => {
    expect(
      uniqueFolderName("/Downloads", makeFolders(["Downloads"])),
    ).toMatchInlineSnapshot(`"Downloads-1"`);
  });

  it("falls back to a numeric suffix once MAX_PARENT_SEGMENTS is exhausted", () => {
    expect(
      uniqueFolderName(
        "/base/archive/nested/project/Downloads",
        makeFolders([
          "Downloads",
          "project-Downloads",
          "nested-project-Downloads",
          "archive-nested-project-Downloads",
        ]),
      ),
    ).toMatchInlineSnapshot(`"archive-nested-project-Downloads-1"`);
  });

  it("disambiguates two sync-folder collisions distinctly", () => {
    const folders = makeFolders([]);
    const local = uniqueFolderName("/base/Downloads", folders);
    folders[local] = {
      createdAt: 0,
      id: FolderAttachment.IdSchema.parse("folder-local"),
      name: local,
      path: AbsolutePathSchema.parse("/base/Downloads"),
      source: "user",
    };

    const synced = uniqueFolderName(
      "/base/Library/Mobile Documents/com~apple~CloudDocs/Downloads",
      folders,
    );

    expect({ local, synced }).toMatchInlineSnapshot(`
      {
        "local": "Downloads",
        "synced": "com~apple~CloudDocs-Downloads",
      }
    `);
  });
});

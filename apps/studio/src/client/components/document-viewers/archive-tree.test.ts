import { describe, expect, it } from "vitest";

import {
  type ArchiveFolder,
  archiveTree,
  matchingFiles,
  relativePath,
  visibleRows,
} from "./archive-tree";

type Member = { filename: string; uncompressedSize: number };

const members = (...filenames: string[]): Member[] =>
  filenames.map((filename) => ({ filename, uncompressedSize: 10 }));

const draw = (root: ArchiveFolder<Member>, expanded: string[] = []) =>
  visibleRows(root, new Set(expanded)).map(
    ({ depth, node }) =>
      `${"  ".repeat(depth)}${node.name}${node.kind === "folder" ? `/ (${node.fileCount}, ${node.size})` : ""}`,
  );

describe("archiveTree", () => {
  it("takes the folder everything sits in as the root", () => {
    const root = archiveTree(
      members(
        "project-main/src/app/index.ts",
        "project-main/src/app/util.ts",
        "project-main/README.md",
        "project-main/docs/guide.md",
      ),
    );
    expect(root.path).toBe("project-main/");
    expect(draw(root, ["project-main/src/"])).toMatchInlineSnapshot(`
      [
        "docs/ (1, 10)",
        "src/ (2, 20)",
        "  app/ (2, 20)",
        "README.md",
      ]
    `);
  });

  it("keeps the root when files sit beside the folders", () => {
    const root = archiveTree(members("a/one.txt", "two.txt"));
    expect(root.path).toBe("");
    expect(draw(root, ["a/"])).toMatchInlineSnapshot(`
      [
        "a/ (1, 10)",
        "  one.txt",
        "two.txt",
      ]
    `);
  });

  it("sorts names the way a person counts", () => {
    const root = archiveTree(members("x/file10.txt", "x/file2.txt"));
    expect(draw(root)).toEqual(["file2.txt", "file10.txt"]);
  });
});

describe("matchingFiles", () => {
  it("finds files under the root by their path below it", () => {
    const root = archiveTree(
      members("wrap/src/index.ts", "wrap/docs/index.md", "wrap/notes.txt"),
    );
    expect(
      matchingFiles(root, "INDEX").map((node) => relativePath(root, node)),
    ).toEqual(["docs/index.md", "src/index.ts"]);
    // The skipped root is not part of what is searched.
    expect(matchingFiles(root, "wrap")).toEqual([]);
  });
});

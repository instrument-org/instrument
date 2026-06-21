import path from "node:path";
import { describe, expect, it } from "vitest";

import { RelativePathSchema, TaskDirSchema } from "../schemas/paths";
import { resolvePathWithinTaskDir } from "./resolve-path-within-app-dir";

describe("resolvePathWithinTaskDir", () => {
  const dir = TaskDirSchema.parse(path.join("/tmp", "project"));

  it.each([
    {
      expected: path.join(dir, "src", "index.ts"),
      filePath: RelativePathSchema.parse("src/index.ts"),
      label: "plain relative",
    },
    {
      expected: path.join(dir, "src", "index.ts"),
      filePath: RelativePathSchema.parse("./src/index.ts"),
      label: "dot-slash relative",
    },
  ])("resolves $label paths inside dir", ({ expected, filePath }) => {
    expect(resolvePathWithinTaskDir({ dir, filePath })).toBe(expected);
  });

  it.each([
    {
      filePath: RelativePathSchema.parse("../outside.txt"),
      label: "parent traversal",
    },
    {
      filePath: RelativePathSchema.parse("src/../../outside.txt"),
      label: "nested traversal",
    },
    {
      filePath: RelativePathSchema.parse("src\\..\\..\\outside.txt"),
      label: "backslash traversal",
    },
  ])("rejects $label", ({ filePath }) => {
    expect(resolvePathWithinTaskDir({ dir, filePath })).toBeNull();
  });
});

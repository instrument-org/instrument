import path from "node:path";
import {
  describe,
  expect,
  it,
} from "vitest";

import {
  AppDirSchema,
  RelativePathSchema,
} from "../schemas/paths";
import {
  resolvePathWithinAppDir,
} from "./resolve-path-within-app-dir";

describe("resolvePathWithinAppDir", () => {
  const appDir = AppDirSchema.parse(path.join("/tmp", "project"));

  it.each([
    {
      expected: path.join(appDir, "src", "index.ts"),
      filePath: RelativePathSchema.parse("src/index.ts"),
      label: "plain relative",
    },
    {
      expected: path.join(appDir, "src", "index.ts"),
      filePath: RelativePathSchema.parse("./src/index.ts"),
      label: "dot-slash relative",
    },
  ])("resolves $label paths inside appDir", ({ expected, filePath }) => {
    expect(resolvePathWithinAppDir({ appDir, filePath })).toBe(expected);
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
    expect(resolvePathWithinAppDir({ appDir, filePath })).toBeNull();
  });
});

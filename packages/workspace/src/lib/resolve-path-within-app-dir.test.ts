import path from "node:path";
import { describe, expect, it } from "vitest";

import { AppDirSchema } from "../schemas/paths";
import { resolvePathWithinAppDir } from "./resolve-path-within-app-dir";

describe("resolvePathWithinAppDir", () => {
  const appDir = AppDirSchema.parse(path.join("/tmp", "project"));

  it.each([
    { filePath: "src/index.ts", label: "plain relative" },
    { filePath: "./src/index.ts", label: "dot-slash relative" },
  ])("resolves $label paths inside appDir", ({ filePath }) => {
    const resolved = resolvePathWithinAppDir(appDir, filePath);
    expect(resolved).toBe(path.join(appDir, "src", "index.ts"));
  });

  it.each([
    { filePath: "../outside.txt", label: "parent traversal" },
    { filePath: "src/../../outside.txt", label: "nested traversal" },
    { filePath: "/etc/passwd", label: "absolute path" },
  ])("rejects $label", ({ filePath }) => {
    expect(resolvePathWithinAppDir(appDir, filePath)).toBeNull();
  });
});

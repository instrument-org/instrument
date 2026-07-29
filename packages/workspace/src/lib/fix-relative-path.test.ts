import { describe, expect, it } from "vitest";

import { fixRelativePath } from "./fix-relative-path";

describe("fixRelativePath", () => {
  it.each([
    { input: "./src/index.ts", label: "normal relative path" },
    { input: "src/index.ts", label: "relative without leading dot" },
    { input: "/src/index.ts", label: "leading-slash path (converted to ./)" },
    { input: "file.txt", label: "bare filename" },
    { input: "./..foo", label: "filename starting with two dots" },
  ])("accepts $label", ({ input }) => {
    expect(fixRelativePath(input)).not.toBeNull();
  });

  it.each([
    { input: "../outside.txt", label: "parent traversal with forward slash" },
    {
      input: "./src/../../../outside.txt",
      label: "nested forward-slash traversal",
    },
    { input: "..", label: "bare parent" },
    { input: "/..", label: "leading-slash parent" },
    {
      input: "./subdir\\..\\..\\outside.txt",
      label: "Windows backslash traversal",
    },
  ])("rejects $label", ({ input }) => {
    expect(fixRelativePath(input)).toBeNull();
  });
});

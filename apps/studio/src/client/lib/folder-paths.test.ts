import { folderNameFromPath, shortenHomePath } from "@instrument-org/shared";
import { describe, expect, it } from "vitest";

describe("folderNameFromPath", () => {
  it.each([
    { expected: "test", label: "a posix path", path: "/Users/sam/Docs/test" },
    {
      expected: "test",
      label: "a Windows path",
      path: String.raw`C:\Users\sam\test`,
    },
    // The two implementations this replaced disagreed here: one answered with
    // the whole path, having found an empty last segment.
    {
      expected: "test",
      label: "a path with a trailing separator",
      path: "/Users/sam/Docs/test/",
    },
    { expected: "/", label: "the filesystem root", path: "/" },
  ])("names $label", ({ expected, path }) => {
    expect(folderNameFromPath(path)).toBe(expected);
  });
});

describe("shortenHomePath", () => {
  it.each([
    {
      expected: "~/Documents/Photos",
      filePath: "/Users/sam/Documents/Photos",
      home: "/Users/sam",
      label: "a path inside home",
    },
    {
      expected: "~",
      filePath: "/Users/sam",
      home: "/Users/sam",
      label: "home itself",
    },
    {
      expected: "~/Documents",
      filePath: "/Users/sam/Documents",
      home: "/Users/sam/",
      label: "a home directory with a trailing separator",
    },
    {
      // Windows separators survive: a list showing this next to a path on
      // another drive would otherwise mix `\` and `/` between its rows.
      expected: String.raw`~\Desktop\notes`,
      filePath: String.raw`C:\Users\sam\Desktop\notes`,
      home: String.raw`C:\Users\sam`,
      label: "a Windows path",
    },
    {
      expected: String.raw`D:\Archive\2026`,
      filePath: String.raw`D:\Archive\2026`,
      home: String.raw`C:\Users\sam`,
      label: "a Windows path on another drive",
    },
    {
      expected: "/Volumes/Media/clips",
      filePath: "/Volumes/Media/clips",
      home: "/Users/sam",
      label: "a path outside home",
    },
    {
      // A sibling whose name starts with the home directory's name is not a
      // child of it, so it must not be rewritten.
      expected: "/Users/samantha/Documents",
      filePath: "/Users/samantha/Documents",
      home: "/Users/sam",
      label: "a sibling sharing a name prefix",
    },
    {
      expected: "/Users/sam/Documents",
      filePath: "/Users/sam/Documents",
      home: undefined,
      label: "an unknown home directory",
    },
  ])("shortens $label", ({ expected, filePath, home }) => {
    expect(shortenHomePath(filePath, home)).toBe(expected);
  });
});

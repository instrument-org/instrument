import { describe, expect, it } from "vitest";

import { shortenHomePath } from "./path-utils";

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

import {
  displayHostPath,
  expandHomePath,
  folderLabelFromPath,
  folderNameFromPath,
  parentSegmentFromPath,
  shortenHomePath,
  typedHostPath,
} from "@instrument-org/shared";
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
    // A backslash is a character a name can hold on a Mac or Linux.
    {
      expected: String.raw`a\b`,
      label: "a posix name holding a backslash",
      path: String.raw`/Users/sam/a\b`,
    },
    {
      expected: "Reports",
      label: "a network share",
      path: String.raw`\\server\share\Reports`,
    },
  ])("names $label", ({ expected, path }) => {
    expect(folderNameFromPath(path)).toBe(expected);
  });
});

describe("parentSegmentFromPath", () => {
  it.each([
    { expected: "Docs", path: "/Users/sam/Docs/test" },
    { expected: "sam", path: String.raw`C:\Users\sam\test` },
    { expected: undefined, path: "/Users" },
    { expected: "sam", path: String.raw`/Users/sam/a\b` },
    { expected: String.raw`a\b`, path: String.raw`/Users/sam/a\b/c` },
  ])("puts $path in $expected", ({ expected, path }) => {
    expect(parentSegmentFromPath(path)).toBe(expected);
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
    {
      // On a Mac or Linux this is a folder called `sam\Documents` beside home.
      expected: String.raw`/Users/sam\Documents`,
      filePath: String.raw`/Users/sam\Documents`,
      home: "/Users/sam",
      label: "a sibling whose name holds a backslash",
    },
  ])("shortens $label", ({ expected, filePath, home }) => {
    expect(shortenHomePath(filePath, home)).toBe(expected);
  });
});

describe("folderLabelFromPath", () => {
  it.each([
    {
      expected: "Home",
      folderPath: "/Users/sam",
      home: "/Users/sam",
      label: "the home folder itself",
    },
    {
      expected: "Home",
      folderPath: "/Users/sam/",
      home: "/Users/sam",
      label: "the home folder with a trailing separator",
    },
    {
      expected: "Home",
      folderPath: String.raw`C:\Users\sam`,
      home: String.raw`C:\Users\sam`,
      label: "a Windows home folder",
    },
    {
      expected: "Documents",
      folderPath: "/Users/sam/Documents",
      home: "/Users/sam",
      label: "a folder inside home",
    },
    {
      // The account name is only ever swapped for the folder that really is
      // home, never for a sibling whose name starts the same way.
      expected: "samantha",
      folderPath: "/Users/samantha",
      home: "/Users/sam",
      label: "a sibling sharing a name prefix",
    },
    {
      expected: "sam",
      folderPath: "/Users/sam",
      home: undefined,
      label: "the home folder with no home directory known",
    },
    {
      // A trailing backslash is part of the name on a Mac or Linux, so this
      // is a folder beside home rather than home itself.
      expected: "sam\\",
      folderPath: "/Users/sam\\",
      home: "/Users/sam",
      label: "a sibling whose name ends in a backslash",
    },
  ])("calls $label $expected", ({ expected, folderPath, home }) => {
    expect(folderLabelFromPath(folderPath, home)).toBe(expected);
  });
});

describe("displayHostPath", () => {
  it.each([
    {
      expected: "sam/Documents/Photos",
      home: "/Users/sam",
      label: "a path inside home",
      path: "/Users/sam/Documents/Photos",
    },
    {
      expected: "sam",
      home: "/Users/sam",
      label: "home itself",
      path: "/Users/sam",
    },
    {
      expected: "sam/Documents",
      home: "/Users/sam",
      label: "a path written from `~`",
      path: "~/Documents",
    },
    {
      expected: String.raw`sam\Documents`,
      home: String.raw`C:\Users\sam`,
      label: "a Windows path inside home",
      path: String.raw`C:\Users\sam\Documents`,
    },
    {
      expected: "/Users/samantha/Documents",
      home: "/Users/sam",
      label: "a sibling sharing a name prefix",
      path: "/Users/samantha/Documents",
    },
    {
      expected: "/Volumes/Backup",
      home: "/home/sam",
      label: "a path outside home",
      path: "/Volumes/Backup",
    },
    // A backslash is a character a name can hold on a Mac or Linux.
    {
      expected: String.raw`sam/Documents/a\b`,
      home: "/Users/sam",
      label: "a posix name holding a backslash",
      path: String.raw`/Users/sam/Documents/a\b`,
    },
    {
      expected: String.raw`/Users/sam\Documents`,
      home: "/Users/sam",
      label: "a sibling whose name holds a backslash",
      path: String.raw`/Users/sam\Documents`,
    },
    {
      expected: String.raw`sam\Documents`,
      home: String.raw`C:\Users\sam`,
      label: "a Windows path written from `~`",
      path: String.raw`~\Documents`,
    },
  ])("reads $label as $expected", ({ expected, home, path }) => {
    expect(displayHostPath(path, home)).toBe(expected);
  });
});

describe("expandHomePath", () => {
  it.each([
    { expected: "/Users/sam", home: "/Users/sam", path: "~" },
    {
      expected: "/Users/sam/Documents",
      home: "/Users/sam/",
      path: "~/Documents",
    },
    {
      expected: String.raw`C:\Users\sam\Documents`,
      home: String.raw`C:\Users\sam`,
      path: "~/Documents",
    },
    { expected: "~user/x", home: "/Users/sam", path: "~user/x" },
    {
      expected: "/Volumes/Backup",
      home: "/Users/sam",
      path: "/Volumes/Backup",
    },
    // A backslash is a character a name can hold on a Mac or Linux, and a
    // separator where home is a Windows path.
    {
      expected: String.raw`/Users/sam/a\b`,
      home: "/Users/sam",
      path: String.raw`~/a\b`,
    },
    {
      expected: String.raw`/Users/a\b/Documents`,
      home: String.raw`/Users/a\b`,
      path: "~/Documents",
    },
    {
      expected: String.raw`~\Documents`,
      home: "/Users/sam",
      path: String.raw`~\Documents`,
    },
    {
      expected: String.raw`C:\Users\sam\Documents\a`,
      home: String.raw`C:\Users\sam`,
      path: String.raw`~\Documents/a`,
    },
  ])("writes $path out as $expected", ({ expected, home, path }) => {
    expect(expandHomePath(path, home)).toBe(expected);
  });
});

describe("typedHostPath", () => {
  it.each([
    {
      expected: "~/Documents/Instrument",
      home: "/Users/sam",
      label: "a folder in home",
      path: "/Users/sam/Documents/Instrument",
    },
    {
      expected: "/Volumes/Backup/Instrument",
      home: "/Users/sam",
      label: "a folder outside home",
      path: "/Volumes/Backup/Instrument",
    },
    // File Explorer takes no `~`, so a Windows path stays whole.
    {
      expected: String.raw`C:\Users\sam\Documents\Instrument`,
      home: String.raw`C:\Users\sam`,
      label: "a Windows folder in home",
      path: String.raw`C:\Users\sam\Documents\Instrument`,
    },
  ])("spells $label as $expected", ({ expected, home, path }) => {
    expect(typedHostPath(path, home)).toBe(expected);
  });
});

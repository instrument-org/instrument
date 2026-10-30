import { describe, expect, it } from "vitest";

import { isPathLike, typedFileName, typedPathOf } from "./typed-path";

describe("typedPathOf", () => {
  it.each([
    ["/Users/casey/Documents/", "/Users/casey/Documents", false],
    ["/", "/", false],
    ["/r/rust", "/r/rust", true],
    ["/Users/casey/Bob's Files", "/Users/casey/Bob's Files", false],
    ["~", "~", false],
    ["~/Acme Corp/", "~/Acme Corp", false],
    ["'/Users/casey/a b.pdf'", "/Users/casey/a b.pdf", false],
    ["/Users/casey/My\\ File.pdf", "/Users/casey/My File.pdf", false],
    ["file:///~/testing123fake", "~/testing123fake", false],
    ["file:///Users/casey/a%20b.html", "/Users/casey/a b.html", false],
    ["file:///Users/casey/notes.md#todo", "/Users/casey/notes.md", false],
  ])("reads %j on a Mac as %j", (words, shown, alsoSearch) => {
    expect(typedPathOf(words, "darwin")).toMatchObject({
      alsoSearch,
      shown,
      typed: words.trim(),
    });
  });

  it.each([
    ["C:\\Users\\casey", "C:\\Users\\casey"],
    ["C:\\", "C:\\"],
    ["c:/Users/casey/", "c:/Users/casey"],
    ['"C:\\Users\\casey\\a b.txt"', "C:\\Users\\casey\\a b.txt"],
    ["~\\Documents", "~\\Documents"],
    ["\\\\server\\share", "\\\\server\\share"],
    ["/c/Users/casey", "/c/Users/casey"],
    ["/tmp/out.log", "/tmp/out.log"],
    ["file:///C:/Users/casey/a%20b.html", "C:\\Users\\casey\\a b.html"],
    ["file://server/share/x", "\\\\server\\share\\x"],
  ])("reads %j on Windows as %j", (words, shown) => {
    expect(typedPathOf(words, "win32")?.shown).toBe(shown);
  });

  it.each([
    ["/r/rust", true],
    ["/c/Users/casey", false],
    ["C:\\Users", false],
  ])("offers %j on Windows as a search too: %s", (words, alsoSearch) => {
    expect(typedPathOf(words, "win32")?.alsoSearch).toBe(alsoSearch);
  });

  it.each([
    ["/Users/casey", "win32"],
    ["~\\Documents", "darwin"],
    ["C:\\Users", "darwin"],
    ["documents/tax.pdf", "darwin"],
    ["file:///Users/casey/wireframe.html?frame=2", "darwin"],
    ["file:///Users/casey/wireframe.htm#intro", "darwin"],
    ["file:///C:/Users/casey/wireframe.html?frame=2", "win32"],
    ["https://example.com", "darwin"],
    ["weather tomorrow", "linux"],
    ['""', "darwin"],
  ] as const)("finds no path in %j on %s", (words, platform) => {
    expect(typedPathOf(words, platform)).toBeUndefined();
  });
});

describe("isPathLike", () => {
  it.each([
    ["~/Documents", true],
    ["C:\\Users", true],
    ["\\\\srv\\share", true],
    ["file:///etc/hosts", true],
    ["weather tomorrow", false],
    ["github.com", false],
  ])("%j → %s", (words, expected) => {
    expect(isPathLike(words)).toBe(expected);
  });
});

describe("typedFileName", () => {
  it.each([
    [
      "~/wireframes/2026-10-27-kit-sync.html",
      "darwin",
      "2026-10-27-kit-sync.html",
    ],
    ["file:///Users/casey/Notes/plan.md", "darwin", "plan.md"],
    ["C:\\Users\\casey\\report.pdf", "win32", "report.pdf"],
    ["~/Documents", "darwin", undefined],
    ["~/Projects/site.com/", "darwin", undefined],
    ["~/.config", "darwin", undefined],
    ["/Users/casey/archive.", "darwin", undefined],
  ])("%s on %s is %s", (words, platform, expected) => {
    const path = typedPathOf(words, platform);
    expect(path && typedFileName(path)).toBe(expected);
  });
});

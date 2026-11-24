import { typedPathOf } from "@/client/lib/typed-path";
import { describe, expect, it } from "vitest";

import { boxOpens, siteToComplete } from "./new-tab-box";

const visited = [
  {
    favicon: undefined,
    title: "Pull requests",
    url: "https://github.com/acme/app/pulls",
    visitCount: 1,
  },
  {
    favicon: undefined,
    title: "Issues",
    url: "https://github.com/acme/app/issues",
    visitCount: 1,
  },
  {
    favicon: undefined,
    title: "Hacker News",
    url: "https://news.ycombinator.com/",
    visitCount: 1,
  },
];

/** What Return does with the words, as the box reads them on a Mac with `visited` as its history. */
function returnDoes(words: string, isSiteFinished = false) {
  const path = typedPathOf(words, "darwin");
  const site = isSiteFinished ? siteToComplete(words, visited) : undefined;
  const opens = boxOpens({ completedSite: site?.url, path, words });
  if (opens === undefined) {
    return "sends";
  }
  if (opens.kind === "path") {
    return `opens path ${opens.path.shown}`;
  }
  if (opens.kind === "site") {
    return `opens ${opens.url}`;
  }
  return `opens ${opens.address.kind === "page" ? opens.address.url : opens.address.address}`;
}

describe("what Return does in a new tab's box", () => {
  it.each([
    ["words", "compare these two plans", "sends"],
    ["one word that is no address", "pricing", "sends"],
    ["a link among words", "read https://example.com for me", "sends"],
    ["two lines", "example.com\nplease", "sends"],
    ["an address and a space", "example.com ", "sends"],
    ["an address in doubt", "node.js", "sends"],
    ["a scheme alone", "ftp://", "sends"],
    ["a slash command", "/proj", "sends"],
    ["an address alone", "example.com", "opens https://example.com/"],
    [
      "an address pasted whole",
      "https://example.com/pricing?plan=team",
      "opens https://example.com/pricing?plan=team",
    ],
    [
      "a path alone",
      "/Users/mac-user/notes.md",
      "opens path /Users/mac-user/notes.md",
    ],
    [
      "a path with an escaped space",
      "/Users/mac-user/My\\ Notes.md",
      "opens path /Users/mac-user/My Notes.md",
    ],
    ["a path and words after it", "/Users/mac-user/foo why is this", "sends"],
  ])("%s: %j %s", (_what, words, does) => {
    expect(returnDoes(words)).toBe(does);
  });

  it("opens the site the box finished one word to", () => {
    expect(returnDoes("git", true)).toBe("opens https://github.com/");
  });

  it("sends one word the box finished to no site", () => {
    expect(returnDoes("hack", true)).toBe("sends");
  });
});

describe("the rest of a site's address a new tab's box writes in", () => {
  it("is for a site visited more than once", () => {
    expect(siteToComplete("git", visited)).toEqual({
      rest: "hub.com",
      url: "https://github.com/",
    });
    expect(siteToComplete("github.c", visited)?.rest).toBe("om");
  });

  it("is nothing for a site visited once, or for words that start none", () => {
    expect(siteToComplete("news", visited)).toBeUndefined();
    expect(siteToComplete("hack", visited)).toBeUndefined();
    expect(siteToComplete("zzz", visited)).toBeUndefined();
  });

  it("is nothing for words that reach past the site into a page on it", () => {
    expect(siteToComplete("github.com/acme", visited)).toBeUndefined();
  });

  it("is nothing once the words have a space", () => {
    expect(siteToComplete("git hub", visited)).toBeUndefined();
  });
});

import { addressInMessage } from "@/client/lib/address-in-message";
import { typedPathOf } from "@/client/lib/typed-path";
import { describe, expect, it } from "vitest";

import { boxCompletions, offersToOpen } from "./new-tab-completions";

const recentPages = [
  {
    favicon: undefined,
    title: "Pull requests",
    url: "https://github.com/acme/app/pulls",
  },
  {
    favicon: undefined,
    title: "Hacker News",
    url: "https://news.ycombinator.com/",
  },
];
const bookmarkPages = [
  { favicon: undefined, title: "Gist", url: "https://gist.github.com/" },
];

function rowsFor(words: string) {
  const path = typedPathOf(words, "darwin");
  const { picked, rows } = boxCompletions({
    address: path ? undefined : addressInMessage(words),
    bookmarkPages,
    path,
    recentPages,
    words,
  });
  return {
    picked,
    rows: rows.map((row) =>
      row.kind === "page"
        ? `page ${row.page.url}`
        : row.kind === "path"
          ? `path ${row.path.shown}`
          : `address ${row.address.kind === "page" ? row.address.url : row.address.address}`,
    ),
  };
}

describe("whether a new tab's box offers to open what is in it", () => {
  it.each([
    ["example.com", true],
    ["hello", true],
    ["example.com ", false],
    ["two words", false],
    ["two\nlines", false],
    ["", false],
    ["/proj", false],
    ["/Users/me/notes.md", true],
    ["/Users/me/My\\ Notes.md", true],
    ['"/Users/me/My Notes.md"', true],
    ["/Users/me/foo why is this", false],
  ])("%j: %s", (words, offers) => {
    expect(offersToOpen(words, typedPathOf(words, "darwin"))).toBe(offers);
  });
});

describe("a new tab's completions", () => {
  it("leads with the address typed, picked, then the site history completes to", () => {
    expect(rowsFor("gith")).toMatchInlineSnapshot(`
      {
        "picked": -1,
        "rows": [
          "page https://github.com/",
          "page https://gist.github.com/",
          "page https://github.com/acme/app/pulls",
        ],
      }
    `);
    expect(rowsFor("github.co")).toMatchInlineSnapshot(`
      {
        "picked": 0,
        "rows": [
          "address https://github.co",
          "page https://github.com/",
          "page https://gist.github.com/",
          "page https://github.com/acme/app/pulls",
        ],
      }
    `);
  });

  it("picks nothing for words that are no address, so Return sends them", () => {
    expect(rowsFor("hacker")).toMatchInlineSnapshot(`
      {
        "picked": -1,
        "rows": [
          "page https://news.ycombinator.com/",
        ],
      }
    `);
  });

  it("offers a path or a file address alone", () => {
    expect(rowsFor("/Users/me/notes.md")).toMatchInlineSnapshot(`
      {
        "picked": 0,
        "rows": [
          "path /Users/me/notes.md",
        ],
      }
    `);
    expect(rowsFor("file:///Users/me/notes.md")).toMatchInlineSnapshot(`
      {
        "picked": 0,
        "rows": [
          "path /Users/me/notes.md",
        ],
      }
    `);
  });
});

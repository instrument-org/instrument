import { typedPathOf } from "@/client/lib/typed-path";
import { describe, expect, it } from "vitest";

import { type Named } from "./name-search";
import {
  boxAddress,
  boxCompletions,
  offersToOpen,
  siteToComplete,
} from "./new-tab-completions";
import { type SearchThing } from "./search-sources";

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
const bookmarkPages = [
  { favicon: undefined, title: "Gist", url: "https://gist.github.com/" },
];

const page = (title: string, url: string, pinned = false) =>
  ({
    also: { name: url.replace(/^https:\/\//, "").replace(/\/$/, "") },
    id: `page:${url}`,
    name: title,
    pinned,
    value: {
      kind: "page",
      page: { favicon: undefined, title, url },
      where: undefined,
    },
  }) satisfies Named<SearchThing>;
const folder = (name: string, pinned = false) =>
  ({
    id: `folder:/Users/mac-user/${name}`,
    name,
    pinned,
    value: {
      folder: { name, path: `/Users/mac-user/${name}` },
      kind: "folder",
      where: undefined,
    },
  }) satisfies Named<SearchThing>;

/** What the box finds by name: the bookmark and the pages visited, and some folders. */
const named: Named<SearchThing>[] = [
  page("Gist", "https://gist.github.com/", true),
  ...visited.map((each) => page(each.title, each.url)),
  folder("GitHub exports", true),
  folder("Hackathon"),
  ...["one", "two", "three", "four", "five", "six", "seven"].map((count) =>
    folder(`Plan ${count}`),
  ),
];

function rowsFor(
  words: string,
  options: { isCompleted?: boolean; remembered?: string } = {},
) {
  const path = typedPathOf(words, "darwin");
  const { picked, rows } = boxCompletions({
    address: path ? undefined : boxAddress(words),
    bookmarkPages,
    named,
    path,
    recentPages: visited,
    words,
    ...options,
  });
  return {
    picked,
    rows: rows.map((row) =>
      row.kind === "site"
        ? `site ${row.page.url}`
        : row.kind === "thing"
          ? row.id
          : row.kind === "path"
            ? `path ${row.path.shown}`
            : `address ${row.address.kind === "page" ? row.address.url : row.address.address}`,
    ),
  };
}

/** What Return does with the rows as they stand, the lit row being `picked`. */
function returnDoes({ picked, rows }: ReturnType<typeof rowsFor>) {
  return picked === -1 ? "sends the words" : `opens ${rows[picked]}`;
}

describe("whether a new tab's box offers to open what is in it", () => {
  it.each([
    ["example.com", true],
    ["hello", true],
    ["example.com ", false],
    ["two words", false],
    ["two\nlines", false],
    ["", false],
    ["/", false],
    ["/proj", false],
    ["/tmp", true],
    ["/Users", true],
    ["/Users/me/notes.md", true],
    ["/Users/me/My\\ Notes.md", true],
    ['"/Users/me/My Notes.md"', true],
    ["/Users/me/foo why is this", false],
  ])("%j: %s", (words, offers) => {
    expect(offersToOpen(words, typedPathOf(words, "darwin"))).toBe(offers);
  });
});

describe("a new tab's completions", () => {
  it("lists the site the words start, then what they find by name, with nothing picked", () => {
    const rows = rowsFor("git");
    expect(rows).toMatchInlineSnapshot(`
      {
        "picked": -1,
        "rows": [
          "site https://github.com/",
          "folder:/Users/mac-user/GitHub exports",
          "page:https://github.com/acme/app/issues",
          "page:https://github.com/acme/app/pulls",
          "page:https://gist.github.com/",
        ],
      }
    `);
    expect(returnDoes(rows)).toBe("sends the words");
  });

  it("leads with an address typed whole, picked", () => {
    const rows = rowsFor("github.co");
    expect(rows).toMatchInlineSnapshot(`
      {
        "picked": 0,
        "rows": [
          "address https://github.co/",
          "site https://github.com/",
          "page:https://github.com/acme/app/issues",
          "page:https://github.com/acme/app/pulls",
          "page:https://gist.github.com/",
        ],
      }
    `);
    expect(returnDoes(rows)).toBe("opens address https://github.co/");
  });

  it("picks the site while the box has written the rest of its address in", () => {
    const rows = rowsFor("git", { isCompleted: true });
    expect(rows.rows[0]).toBe("site https://github.com/");
    expect(returnDoes(rows)).toBe("opens site https://github.com/");
    // Over the address the letters typed so far happen to be.
    expect(returnDoes(rowsFor("github.co", { isCompleted: true }))).toBe(
      "opens site https://github.com/",
    );
  });

  it("picks nothing for words that only find things by name, so Return sends them", () => {
    const rows = rowsFor("hack");
    expect(rows).toMatchInlineSnapshot(`
      {
        "picked": -1,
        "rows": [
          "folder:/Users/mac-user/Hackathon",
          "page:https://news.ycombinator.com/",
        ],
      }
    `);
    expect(returnDoes(rows)).toBe("sends the words");
    // Completed or not, with no site to complete to.
    expect(returnDoes(rowsFor("hack", { isCompleted: true }))).toBe(
      "sends the words",
    );
  });

  it("opens the lit row once an arrow has moved to it", () => {
    const { rows } = rowsFor("hack");
    expect(returnDoes({ picked: 1, rows })).toBe(
      "opens page:https://news.ycombinator.com/",
    );
  });

  it("lists six things found at most, after the address rows", () => {
    expect(rowsFor("plan").rows).toHaveLength(6);
    expect(
      rowsFor("p").rows.filter((row) => row.startsWith("folder:")),
    ).toHaveLength(6);
  });

  it("moves the remembered pick to the front of what was found, still not picked", () => {
    const rows = rowsFor("git", {
      remembered: "page:https://github.com/acme/app/issues",
    });
    expect(rows.rows.slice(0, 2)).toEqual([
      "site https://github.com/",
      "page:https://github.com/acme/app/issues",
    ]);
    expect(rows.picked).toBe(-1);
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

describe("the rest of a site's address a new tab's box writes in", () => {
  it("is for a site visited more than once", () => {
    expect(siteToComplete("git", visited)).toBe("hub.com");
    expect(siteToComplete("GitH", visited)).toBe("ub.com");
  });

  it("is nothing for a site visited once, or for words that start none", () => {
    expect(siteToComplete("news", visited)).toBeUndefined();
    expect(siteToComplete("zzz", visited)).toBeUndefined();
    expect(siteToComplete("git hub", visited)).toBeUndefined();
  });

  it("is nothing for words that reach past the site into a page on it", () => {
    expect(siteToComplete("github.com/acme", visited)).toBeUndefined();
  });
});

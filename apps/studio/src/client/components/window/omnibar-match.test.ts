import { describe, expect, it } from "vitest";

import {
  addressCompletion,
  bareAddress,
  hostPathOf,
  matchEntries,
  matchNames,
  matchPages,
  pathQuery,
} from "./omnibar-match";

const pages = [
  { title: "Pull requests", url: "https://github.com/acme/app/pulls" },
  { title: "Inbox", url: "https://mail.google.com/mail/u/0/" },
  { title: "GitHub", url: "https://www.github.com/" },
  { title: "Hacker News", url: "https://news.ycombinator.com/" },
];

describe("bareAddress", () => {
  it.each([
    ["https://www.github.com/", "github.com"],
    ["http://example.com/a/b/", "example.com/a/b"],
    ["https://mail.google.com/mail", "mail.google.com/mail"],
  ])("%s reads as %s", (url, bare) => {
    expect(bareAddress(url)).toBe(bare);
  });
});

describe("addressCompletion", () => {
  it.each([
    ["git", "hub.com"],
    ["GIT", "hub.com"],
    ["www.git", "hub.com"],
    ["github.com/ac", "me/app/pulls"],
    ["mail", ".google.com"],
    ["news", ".ycombinator.com"],
    ["nothing", ""],
    ["git hub", ""],
    ["", ""],
  ])("%j finishes with %j", (typed, rest) => {
    expect(addressCompletion(typed, pages)).toBe(rest);
  });
});

describe("matchPages", () => {
  it("puts an address the words start ahead of a title holding them", () => {
    expect(
      matchPages("git", [
        { title: "Why git is hard", url: "https://blog.example.com/" },
        ...pages,
      ]).map((page) => page.title),
    ).toMatchInlineSnapshot(`
      [
        "Pull requests",
        "GitHub",
        "Why git is hard",
      ]
    `);
  });

  it("needs every word, and not letters scattered through a title", () => {
    expect(matchPages("hacker news", pages).map((page) => page.title)).toEqual([
      "Hacker News",
    ]);
    expect(matchPages("hkn", pages)).toEqual([]);
  });
});

describe("matchNames", () => {
  const names = ["Google Calendar", "Gmail", "Linear", "Calendly", "Slack"];

  it("ranks a start, then a word's start, then anywhere, then a near miss", () => {
    expect(matchNames("cal", names, (name) => name)).toEqual([
      "Calendly",
      "Google Calendar",
    ]);
    expect(matchNames("lin", names, (name) => name)).toEqual(["Linear"]);
    expect(matchNames("ack", names, (name) => name)).toEqual(["Slack"]);
    expect(matchNames("gmal", names, (name) => name)).toEqual(["Gmail"]);
  });
});

describe("pathQuery", () => {
  const where = { here: "/Users/me/Projects", home: "/Users/me" };

  it.each([
    ["~/Doc", { folder: "/Users/me", lead: "~/", prefix: "Doc" }],
    ["~/", { folder: "/Users/me", lead: "~/", prefix: "" }],
    ["~", { folder: "/Users/me", lead: "~/", prefix: "" }],
    ["/", { folder: "/", lead: "/", prefix: "" }],
    [
      "/Applications/Sa",
      { folder: "/Applications", lead: "/Applications/", prefix: "Sa" },
    ],
    ["app", { folder: "/Users/me/Projects", lead: "", prefix: "app" }],
    [
      "app/src/",
      { folder: "/Users/me/Projects/app/src", lead: "app/src/", prefix: "" },
    ],
    ["../Desk", { folder: "/Users/me", lead: "../", prefix: "Desk" }],
    [
      "My Folder/n",
      {
        folder: "/Users/me/Projects/My Folder",
        lead: "My Folder/",
        prefix: "n",
      },
    ],
  ])("%j", (typed, expected) => {
    expect(pathQuery(typed, where)).toEqual(expected);
  });

  it("reads a Windows path from its drive", () => {
    expect(
      pathQuery("C:\\Users\\me\\Doc", {
        here: "C:\\Users\\me",
        home: "C:\\Users\\me",
      }),
    ).toEqual({
      folder: "C:\\Users\\me",
      lead: "C:\\Users\\me\\",
      prefix: "Doc",
    });
  });
});

describe("hostPathOf", () => {
  const where = { here: "/Users/me/Projects", home: "/Users/me" };

  it.each([
    ["~", "/Users/me"],
    ["~/Desktop", "/Users/me/Desktop"],
    ["/tmp", "/tmp"],
    ["notes.md", "/Users/me/Projects/notes.md"],
    ["./a/../b", "/Users/me/Projects/b"],
    ["../../../..", "/"],
    ["", "/Users/me/Projects"],
  ])("%j is %j", (written, host) => {
    expect(hostPathOf(written, where)).toBe(host);
  });
});

describe("matchEntries", () => {
  const entries = [
    { kind: "file" as const, name: "docs.md", path: "/x/docs.md" },
    { kind: "folder" as const, name: "Documents", path: "/x/Documents" },
    { kind: "folder" as const, name: "Downloads", path: "/x/Downloads" },
    { kind: "folder" as const, name: ".config", path: "/x/.config" },
    {
      hidden: true,
      kind: "folder" as const,
      name: "Library",
      path: "/x/Library",
    },
    { kind: "file" as const, name: "my-docs.txt", path: "/x/my-docs.txt" },
  ];
  const names = (prefix: string) =>
    matchEntries(prefix, entries).map((entry) => entry.name);

  it("puts names the start begins first, folders ahead of files", () => {
    expect(names("do")).toEqual([
      "Documents",
      "Downloads",
      "docs.md",
      "my-docs.txt",
    ]);
  });

  it("lists every visible entry for an empty start, and hidden ones once asked", () => {
    expect(names("")).toEqual([
      "Documents",
      "Downloads",
      "docs.md",
      "my-docs.txt",
    ]);
    expect(names(".c")).toEqual([".config"]);
  });
});

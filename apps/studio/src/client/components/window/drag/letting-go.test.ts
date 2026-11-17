import { describe, expect, it, vi } from "vitest";

// What a link opens as is read through the window's openers, which reach
// main; nothing here asks main anything.
vi.mock("@/client/rpc/client", () => ({ rpcClient: {} }));

import { heldTabsOf, opensOf } from "./held-tabs";
import { outcomeOf } from "./letting-go";
import { type Held, type Landing } from "./types";

const LIT = { height: 600, left: 0, top: 0, width: 400 };

/** One of everything that can be held, by the source it comes from. */
const HELD: Record<string, Held> = {
  "tab (strip or sidebar row half)": {
    group: "g1",
    id: "t1",
    key: "t1",
    kind: "tab",
    side: 0,
  },
  "whole group (sidebar row)": { group: "g2", height: 52, kind: "group" },
  "files (Files row, place, Finder)": {
    count: 1,
    files: [{ hostPath: "/Users/mac-user/Roof quote.pdf", isFolder: false }],
    ids: ["f1"],
    kind: "files",
  },
  "link (page or reply)": {
    id: "tab_01M7HE1DL1NK000000000000",
    kind: "link",
    title: "Pricing",
    url: "https://example.com/pricing",
  },
  "chat chip or Chats row": {
    id: "tab_01M7HE1DL1NK000000000000",
    kind: "link",
    title: "Roof quotes",
    url: "instrument://chat/c1",
  },
  "bookmark (bar)": {
    bookmark: "b1",
    id: "tab_b1",
    kind: "link",
    title: "Example",
    url: "https://example.com/",
  },
  "place (Pinned)": {
    id: "tab_p1",
    kind: "link",
    place: {
      path: "/Users/mac-user/Documents",
      pinned: ["/Users/mac-user", "/Users/mac-user/Documents"],
    },
    title: "Documents",
    url: "file:///Users/mac-user/Documents/",
  },
  "place (Files menu)": {
    id: "tab_p2",
    kind: "link",
    place: { path: "/Users/mac-user/Documents" },
    title: "Documents",
    url: "file:///Users/mac-user/Documents/",
  },
};

const EDGE = { height: 576, left: 3, top: 12, width: 3 };

/** One of every place to land, by what it is on screen. */
const LANDINGS: Record<string, Landing | undefined> = {
  "own strip": { group: "g1", index: 1, kind: "strip", side: 0 },
  "strip line": { group: "g1", index: 1, kind: "strip", line: LIT, side: 0 },
  "strip tab": { group: "g1", kind: "replace", lit: LIT, side: 0, tab: "t1" },
  "left edge, one side": {
    edge: EDGE,
    group: "g1",
    kind: "side",
    lit: LIT,
    side: 0,
    split: true,
  },
  "right edge, one side": {
    edge: EDGE,
    group: "g1",
    kind: "side",
    lit: LIT,
    side: 1,
    split: true,
  },
  "middle, one side": {
    group: "g1",
    isLone: true,
    kind: "side",
    lit: LIT,
    side: 0,
    split: false,
  },
  "right side of two": {
    group: "g1",
    kind: "side",
    lit: LIT,
    side: 1,
    split: false,
  },
  "right edge, two sides": {
    edge: EDGE,
    group: "g1",
    kind: "side",
    lit: LIT,
    side: 1,
    split: false,
  },
  "new tab's page": { group: "g1", kind: "newTab", lit: LIT, tab: "n1" },
  "sidebar row": {
    drop: { group: "g3", kind: "into" },
    kind: "sidebar",
  },
  "sidebar room": {
    drop: { before: undefined, gap: 52, kind: "between", place: {}, top: 0 },
    kind: "sidebar",
  },
  "sidebar line": {
    drop: { before: undefined, gap: 0, kind: "between", place: {}, top: 0 },
    kind: "sidebar",
  },
  "bookmarks bar": { index: 0, kind: "bookmarks" },
  "Pinned line": { index: 2, kind: "pin", line: LIT, moves: false },
  "Pinned line, a row of it": { index: 2, kind: "pin", line: LIT, moves: true },
  "Pinned row, own files": {
    copies: false,
    folder: "/Users/mac-user/Downloads",
    kind: "into",
    lit: LIT,
    name: "Downloads",
  },
  "Pinned row, from Finder": {
    copies: true,
    folder: "/Users/mac-user/Downloads",
    kind: "into",
    lit: LIT,
    name: "Downloads",
  },
  "past the window": { kind: "window" },
  "over nothing, a Pinned row": {
    kind: "unpin",
    path: "/Users/mac-user/Documents",
  },
  "message box": { box: "c1", kind: "attach" },
  nowhere: undefined,
};

/** The groups the lines name. */
const groupTitle = (group: string) =>
  ({ g1: "Q4 roadmap", g3: "Reading" })[group];

describe("outcomeOf", () => {
  it("says what letting go does for every pair of held and landing", () => {
    const table = Object.entries(HELD).flatMap(([heldName, held]) => [
      `${heldName}:`,
      ...Object.entries(LANDINGS).map(([landingName, landing]) => {
        const { does, line } = outcomeOf(held, landing, { groupTitle });
        return `  ${landingName} → ${does}${line ? ` · "${line}"` : ""}`;
      }),
    ]);
    expect(table.join("\n")).toMatchInlineSnapshot(`
      "tab (strip or sidebar row half):
        own strip → move
        strip line → move · "Move here"
        strip tab → nothing
        left edge, one side → move · "Move to the left"
        right edge, one side → move · "Move to the right"
        middle, one side → nothing
        right side of two → move · "Move to the right"
        right edge, two sides → move · "Move to the right"
        new tab's page → nothing
        sidebar row → move · "Move to Reading"
        sidebar room → move · "New tab group"
        sidebar line → move · "New tab group"
        bookmarks bar → keep · "Add to bookmarks"
        Pinned line → pin · "Pin to sidebar"
        Pinned line, a row of it → pin · "Move here"
        Pinned row, own files → into · "Move into Downloads"
        Pinned row, from Finder → into · "Copy into Downloads"
        past the window → move · "Open in a new window"
        over nothing, a Pinned row → nothing
        message box → nothing
        nowhere → nothing
      whole group (sidebar row):
        own strip → move
        strip line → move · "Move 1 tab here"
        strip tab → nothing
        left edge, one side → move · "Open on the left"
        right edge, one side → move · "Open on the right"
        middle, one side → nothing
        right side of two → move · "Open on the right"
        right edge, two sides → move · "Open on the right"
        new tab's page → nothing
        sidebar row → nothing
        sidebar room → move
        sidebar line → move
        bookmarks bar → keep · "Add to bookmarks"
        Pinned line → pin · "Pin to sidebar"
        Pinned line, a row of it → pin · "Move here"
        Pinned row, own files → into · "Move into Downloads"
        Pinned row, from Finder → into · "Copy into Downloads"
        past the window → move · "Open in a new window"
        over nothing, a Pinned row → nothing
        message box → nothing
        nowhere → nothing
      files (Files row, place, Finder):
        own strip → open
        strip line → open · "Open in a new tab"
        strip tab → open · "Open in this tab"
        left edge, one side → open · "Open on the left"
        right edge, one side → open · "Open on the right"
        middle, one side → open · "Open in a new tab"
        right side of two → open · "Open on the right"
        right edge, two sides → open · "Open on the right"
        new tab's page → open · "Open in this tab"
        sidebar row → open · "Add to Reading"
        sidebar room → open · "New tab group"
        sidebar line → open · "New tab group"
        bookmarks bar → keep · "Add to bookmarks"
        Pinned line → pin · "Pin to sidebar"
        Pinned line, a row of it → pin · "Move here"
        Pinned row, own files → into · "Move into Downloads"
        Pinned row, from Finder → into · "Copy into Downloads"
        past the window → open · "Open in a new window"
        over nothing, a Pinned row → nothing
        message box → nothing
        nowhere → nothing
      link (page or reply):
        own strip → open
        strip line → open · "Open in a new tab"
        strip tab → open · "Open in this tab"
        left edge, one side → open · "Open on the left"
        right edge, one side → open · "Open on the right"
        middle, one side → open · "Open in a new tab"
        right side of two → open · "Open on the right"
        right edge, two sides → open · "Open on the right"
        new tab's page → open · "Open in this tab"
        sidebar row → open · "Add to Reading"
        sidebar room → open · "New tab group"
        sidebar line → open · "New tab group"
        bookmarks bar → keep · "Add to bookmarks"
        Pinned line → pin · "Pin to sidebar"
        Pinned line, a row of it → pin · "Move here"
        Pinned row, own files → into · "Move into Downloads"
        Pinned row, from Finder → into · "Copy into Downloads"
        past the window → open · "Open in a new window"
        over nothing, a Pinned row → nothing
        message box → nothing
        nowhere → nothing
      chat chip or Chats row:
        own strip → open
        strip line → open · "Open in a new tab"
        strip tab → open · "Open in this tab"
        left edge, one side → open · "Open on the left"
        right edge, one side → open · "Open on the right"
        middle, one side → open · "Open in a new tab"
        right side of two → open · "Open on the right"
        right edge, two sides → open · "Open on the right"
        new tab's page → open · "Open in this tab"
        sidebar row → open · "Add to Reading"
        sidebar room → open · "New tab group"
        sidebar line → open · "New tab group"
        bookmarks bar → keep · "Add to bookmarks"
        Pinned line → pin · "Pin to sidebar"
        Pinned line, a row of it → pin · "Move here"
        Pinned row, own files → into · "Move into Downloads"
        Pinned row, from Finder → into · "Copy into Downloads"
        past the window → open · "Open in a new window"
        over nothing, a Pinned row → nothing
        message box → nothing
        nowhere → nothing
      bookmark (bar):
        own strip → open
        strip line → open · "Open in a new tab"
        strip tab → open · "Open in this tab"
        left edge, one side → open · "Open on the left"
        right edge, one side → open · "Open on the right"
        middle, one side → nothing
        right side of two → nothing
        right edge, two sides → open · "Open on the right"
        new tab's page → nothing
        sidebar row → open · "Add to Reading"
        sidebar room → open · "New tab group"
        sidebar line → open · "New tab group"
        bookmarks bar → keep · "Move here"
        Pinned line → pin · "Pin to sidebar"
        Pinned line, a row of it → pin · "Move here"
        Pinned row, own files → into · "Move into Downloads"
        Pinned row, from Finder → into · "Copy into Downloads"
        past the window → open · "Open in a new window"
        over nothing, a Pinned row → nothing
        message box → nothing
        nowhere → nothing
      place (Pinned):
        own strip → open
        strip line → open · "Open in a new tab"
        strip tab → open · "Open in this tab"
        left edge, one side → nothing
        right edge, one side → nothing
        middle, one side → nothing
        right side of two → nothing
        right edge, two sides → nothing
        new tab's page → nothing
        sidebar row → open · "Add to Reading"
        sidebar room → open · "New tab group"
        sidebar line → open · "New tab group"
        bookmarks bar → keep · "Add to bookmarks"
        Pinned line → pin · "Pin to sidebar"
        Pinned line, a row of it → pin · "Move here"
        Pinned row, own files → into · "Move into Downloads"
        Pinned row, from Finder → into · "Copy into Downloads"
        past the window → open · "Open in a new window"
        over nothing, a Pinned row → unpin · "Unpin"
        message box → attach
        nowhere → nothing
      place (Files menu):
        own strip → open
        strip line → open · "Open in a new tab"
        strip tab → open · "Open in this tab"
        left edge, one side → nothing
        right edge, one side → nothing
        middle, one side → nothing
        right side of two → nothing
        right edge, two sides → nothing
        new tab's page → nothing
        sidebar row → open · "Add to Reading"
        sidebar room → open · "New tab group"
        sidebar line → open · "New tab group"
        bookmarks bar → keep · "Add to bookmarks"
        Pinned line → pin · "Pin to sidebar"
        Pinned line, a row of it → pin · "Move here"
        Pinned row, own files → into · "Move into Downloads"
        Pinned row, from Finder → into · "Copy into Downloads"
        past the window → open · "Open in a new window"
        over nothing, a Pinned row → nothing
        message box → attach
        nowhere → nothing"
    `);
  });

  it.each([
    ["strip line", "Move 3 tabs here"],
    ["right edge, one side", "Open on the right"],
  ] as const)("says how many tabs a whole group brings to %s", (at, line) => {
    expect(
      outcomeOf(HELD["whole group (sidebar row)"]!, LANDINGS[at], {
        tabCount: 3,
      }).line,
    ).toBe(line);
  });
});

describe("what a held link or files open as", () => {
  it.each(Object.entries(HELD))("%s", (_, held) => {
    expect(
      heldTabsOf(held, []).map((tab) =>
        tab.kind === "page" ? `page ${tab.url ?? ""}` : `screen ${tab.href}`,
      ),
    ).toEqual(
      held.kind === "tab" || held.kind === "group"
        ? []
        : expect.arrayContaining([expect.any(String)]),
    );
    expect(opensOf(held).length).toBe(
      held.kind === "tab" || held.kind === "group" ? 0 : 1,
    );
  });

  it("opens a file by the same tab Files opens it as", () => {
    expect(heldTabsOf(HELD["files (Files row, place, Finder)"]!, []))
      .toMatchInlineSnapshot(`
      [
        {
          "href": "/files?file=%2FUsers%2Fmac-user%2FRoof%20quote.pdf&path=&root=~",
          "id": "f1",
          "kind": "screen",
        },
      ]
    `);
    expect(heldTabsOf(HELD["chat chip or Chats row"]!, []))
      .toMatchInlineSnapshot(`
      [
        {
          "href": "/chats/c1",
          "id": "tab_01M7HE1DL1NK000000000000",
          "kind": "screen",
        },
      ]
    `);
  });

  it("opens nothing for a link the system's drag has not named yet", () => {
    expect(
      heldTabsOf({ id: "x", kind: "link", title: "", url: "" }, []),
    ).toEqual([]);
  });
});

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
};

/** One of every place to land, by what it is on screen. */
const LANDINGS: Record<string, Landing | undefined> = {
  "own strip": { group: "g1", index: 1, kind: "strip", side: 0 },
  "strip line": { group: "g1", index: 1, kind: "strip", line: LIT, side: 0 },
  "strip tab": { group: "g1", kind: "replace", lit: LIT, side: 0, tab: "t1" },
  "Add left split": {
    group: "g1",
    kind: "side",
    lit: LIT,
    side: 0,
    split: true,
  },
  "Add right split": {
    group: "g1",
    kind: "side",
    lit: LIT,
    side: 1,
    split: true,
  },
  "other side": { group: "g1", kind: "side", lit: LIT, side: 1, split: false },
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
  "past the window": { kind: "window" },
  nowhere: undefined,
};

describe("outcomeOf", () => {
  it("says what letting go does for every pair of held and landing", () => {
    const table = Object.entries(HELD).flatMap(([heldName, held]) => [
      `${heldName}:`,
      ...Object.entries(LANDINGS).map(([landingName, landing]) => {
        const { does, line } = outcomeOf(held, landing);
        return `  ${landingName} → ${does}${line ? ` · "${line}"` : ""}`;
      }),
    ]);
    expect(table.join("\n")).toMatchInlineSnapshot(`
      "tab (strip or sidebar row half):
        own strip → move
        strip line → move · "Move to this side"
        strip tab → nothing
        Add left split → move · "Add left split"
        Add right split → move · "Add right split"
        other side → move · "Move to this side"
        new tab's page → move · "Open here"
        sidebar row → move · "Add to this group"
        sidebar room → move · "New tab group"
        sidebar line → move · "New tab group"
        bookmarks bar → keep · "Add to bookmarks"
        past the window → move · "New window"
        nowhere → nothing
      whole group (sidebar row):
        own strip → move
        strip line → move · "Move to this side"
        strip tab → nothing
        Add left split → move · "Add left split"
        Add right split → move · "Add right split"
        other side → move · "Move to this side"
        new tab's page → move · "Open here"
        sidebar row → nothing
        sidebar room → move
        sidebar line → move
        bookmarks bar → keep · "Add to bookmarks"
        past the window → move · "New window"
        nowhere → nothing
      files (Files row, place, Finder):
        own strip → open
        strip line → open · "Open in a new tab"
        strip tab → open · "Open in this tab"
        Add left split → open · "Add left split"
        Add right split → open · "Add right split"
        other side → open · "Open on this side"
        new tab's page → open · "Open here"
        sidebar row → open · "Add to this group"
        sidebar room → open · "New tab group"
        sidebar line → open · "New tab group"
        bookmarks bar → keep · "Add to bookmarks"
        past the window → open · "New window"
        nowhere → nothing
      link (page or reply):
        own strip → open
        strip line → open · "Open in a new tab"
        strip tab → open · "Open in this tab"
        Add left split → open · "Add left split"
        Add right split → open · "Add right split"
        other side → open · "Open on this side"
        new tab's page → open · "Open here"
        sidebar row → open · "Add to this group"
        sidebar room → open · "New tab group"
        sidebar line → open · "New tab group"
        bookmarks bar → keep · "Add to bookmarks"
        past the window → open · "New window"
        nowhere → nothing
      chat chip or Chats row:
        own strip → open
        strip line → open · "Open in a new tab"
        strip tab → open · "Open in this tab"
        Add left split → open · "Add left split"
        Add right split → open · "Add right split"
        other side → open · "Open on this side"
        new tab's page → open · "Open here"
        sidebar row → open · "Add to this group"
        sidebar room → open · "New tab group"
        sidebar line → open · "New tab group"
        bookmarks bar → keep · "Add to bookmarks"
        past the window → open · "New window"
        nowhere → nothing
      bookmark (bar):
        own strip → open
        strip line → open · "Open in a new tab"
        strip tab → open · "Open in this tab"
        Add left split → open · "Add left split"
        Add right split → open · "Add right split"
        other side → open · "Open on this side"
        new tab's page → open · "Open here"
        sidebar row → open · "Add to this group"
        sidebar room → open · "New tab group"
        sidebar line → open · "New tab group"
        bookmarks bar → keep
        past the window → open · "New window"
        nowhere → nothing"
    `);
  });

  it.each([
    ["Add left split", "Add left split · 3 tabs"],
    ["other side", "Move to this side · 3 tabs"],
  ] as const)("says how many tabs a whole group brings to %s", (at, line) => {
    expect(
      outcomeOf(HELD["whole group (sidebar row)"]!, LANDINGS[at], 3).line,
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

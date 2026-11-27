import { fileHref } from "@/shared/computer-href";
import { type TabsModel, TabIdSchema } from "@/shared/tabs";
import { describe, expect, it } from "vitest";

import {
  otherStripShowing,
  stripShowing,
  windowListingGroup,
  windowWithGroupTabShowing,
  windowWithGroupNamed,
} from "./tab-showing";

const HOME = "/Users/mac-user";
const NOTES = `${HOME}/notes.md`;
/** A file's tab as it stands once the route has settled its layout. */
const SETTLED = `/files?file=${encodeURIComponent(NOTES)}&path=&root=~&view=columns`;

function strip(pathnames: string[], up = 0): TabsModel {
  const tabs = pathnames.map((pathname, at) => ({
    id: TabIdSchema.parse(`t${at.toString()}`),
    pathname,
  }));
  return { recentlyClosed: [], selectedId: tabs[up]?.id ?? null, tabs };
}

describe("stripShowing", () => {
  it.each([
    ["a file whose tab settled its layout", fileHref(NOTES), SETTLED],
    [
      "a folder walked to from home",
      "/files?path=&root=%2FUsers%2Fmac-user%2FDocuments",
      "/files?path=Documents%2F&root=~&view=list",
    ],
    ["a chat at its address", "/chats/c1", "/chats/c1?inbox=1"],
  ])("finds %s", (_, href, kept) => {
    expect(
      stripShowing(
        href,
        [
          { model: strip(["/apps"]), window: "a" },
          { model: strip(["/new-tab", kept]), window: "b" },
        ],
        HOME,
      ),
    ).toBe("b");
  });

  it("takes the window with the tab up over one with it behind", () => {
    expect(
      stripShowing(
        fileHref(NOTES),
        [
          { model: strip(["/apps", SETTLED]), window: "behind" },
          { model: strip([SETTLED]), window: "up" },
        ],
        HOME,
      ),
    ).toBe("up");
  });

  it("finds no window for a page nothing shows", () => {
    expect(
      stripShowing(
        "/browser",
        [{ model: strip(["/apps"]), window: "a" }],
        HOME,
      ),
    ).toBeNull();
  });
});

describe("otherStripShowing", () => {
  it("leaves out the window asking, which already looked at its own", () => {
    const strips = [
      { model: strip([SETTLED]), webContentsId: 1, window: "asking" },
      { model: strip(["/apps", SETTLED]), webContentsId: 2, window: "other" },
    ];
    expect(otherStripShowing(fileHref(NOTES), strips, 1, HOME)).toBe("other");
    expect(
      otherStripShowing(fileHref(NOTES), strips.slice(0, 1), 1, HOME),
    ).toBeNull();
  });
});

describe("windowListingGroup", () => {
  it.each<
    [string, { listed: string[]; up?: string; window: string }[], string | null]
  >([
    [
      "takes the window with the group up over one listing it behind",
      [
        { listed: ["g", "h"], up: "h", window: "behind" },
        { listed: ["g"], up: "g", window: "up" },
      ],
      "up",
    ],
    [
      "takes the first listing it when none has it up",
      [
        { listed: ["h"], up: "h", window: "none" },
        { listed: ["g", "h"], up: "h", window: "first" },
        { listed: ["g"], window: "second" },
      ],
      "first",
    ],
    [
      "finds none where no window lists it",
      [{ listed: ["h"], up: "h", window: "a" }],
      null,
    ],
  ])("%s", (_label, windows, expected) => {
    expect(windowListingGroup("g", windows)).toBe(expected);
  });
});

describe("windowWithGroupNamed", () => {
  const windows = [
    { listed: ["a", "b"], window: "first" },
    { listed: ["c"], window: "second" },
  ];

  it.each<
    [string, { group: string; name: string; shownAt?: number }[], string | null]
  >([
    [
      "finds the window listing the group, whatever the word's case",
      [{ group: "c", name: "New Tab Row" }],
      "second",
    ],
    [
      "takes the group up last of several",
      [
        { group: "a", name: "new tab row", shownAt: 1 },
        { group: "c", name: "new tab row", shownAt: 2 },
      ],
      "second",
    ],
    [
      "passes over a group no open window lists",
      [{ group: "closed", name: "new tab row", shownAt: 9 }],
      null,
    ],
    [
      "finds none for another word",
      [{ group: "a", name: "Command menu" }],
      null,
    ],
  ])("%s", (_label, named, expected) => {
    expect(windowWithGroupNamed("new tab row", windows, named)).toBe(expected);
  });
});

// The window one thing handed over from outside comes up in: the one with a
// tab in a group it lists already showing exactly that thing.
describe("windowWithGroupTabShowing", () => {
  const tabs = [
    { group: "work", href: "/files?path=&root=%2FUsers%2Fmac-user" },
    { group: "notes", href: SETTLED },
    { group: "notes", url: "file:///Users/mac-user/page.html" },
    { group: "chat", href: "/tasks/t1?chat=c1" },
    { group: "closed", href: "/apps/linear" },
  ];
  const windows = [
    { listed: ["work", "closed"], up: "work", window: "front" },
    { listed: ["notes", "chat"], up: "chat", window: "back" },
  ];

  it.each([
    ["a file in another window's group behind", fileHref(NOTES), "back"],
    ["a file whose tab became its page", fileHref(`${HOME}/page.html`), "back"],
    ["a task", "/tasks/t1", "back"],
    ["a folder", "/files?path=&root=%2FUsers%2Fmac-user", "front"],
    ["an app", "/apps/linear", "front"],
    ["a file in a folder a tab shows", fileHref(`${HOME}/other.md`), null],
    ["an app no tab shows", "/apps/notion", null],
  ])("finds %s", (_label, href, expected) => {
    expect(windowWithGroupTabShowing(href, windows, tabs, HOME)).toBe(expected);
  });

  it("takes the window with the group up over one listing it behind", () => {
    expect(
      windowWithGroupTabShowing(
        "/apps/linear",
        [
          { listed: ["closed"], window: "behind" },
          { listed: ["closed"], up: "closed", window: "up" },
        ],
        tabs,
        HOME,
      ),
    ).toBe("up");
  });

  it("finds none in a group no open window lists", () => {
    expect(
      windowWithGroupTabShowing(
        "/apps/linear",
        [{ listed: ["work"], window: "front" }],
        tabs,
        HOME,
      ),
    ).toBeNull();
  });
});

import { bookmarkClicks } from "@/client/components/window/bookmark-menu";
import { type OpenOptions } from "@/client/components/window/context";
import { useWindowPlaces } from "@/client/hooks/use-open-target";
import { type Bookmarks, OTHER_ROOT } from "@/shared/bookmarks";
import { fileHref, folderHref } from "@/shared/computer-href";
import { renderHook } from "@testing-library/react";
import { type MouseEvent } from "react";
import { describe, expect, it } from "vitest";

import { fileAddressOf } from "./address";
import { bookmarksToOpen, openAddressBy, openAllTabOf } from "./open-address";

/** One bookmark of each kind, and where a tab showing it stands. */
const BOOKMARKS = [
  {
    address: "https://example.com/a",
    kind: "page",
    lands: "https://example.com/a",
  },
  {
    address: fileAddressOf("/Users/mac-user/Notes/plan.md"),
    kind: "file",
    lands: fileHref("/Users/mac-user/Notes/plan.md"),
  },
  {
    address: "instrument://file/Users/mac-user/Notes/plan.md",
    kind: "file kept by an earlier build",
    lands: fileHref("/Users/mac-user/Notes/plan.md"),
  },
  {
    address: fileAddressOf("/Users/mac-user/Downloads", { isFolder: true }),
    kind: "folder",
    lands: folderHref("/Users/mac-user/Downloads"),
  },
  {
    address: "instrument://chat/01jz8q0v3w6y8a2b4c6d8e0f2g",
    kind: "chat",
    lands: "/chats/01jz8q0v3w6y8a2b4c6d8e0f2g",
  },
  {
    address: "instrument://settings/providers",
    kind: "built-in page",
    lands: "/settings/providers",
  },
] as const;

type Call = [sink: string, at: string, options?: OpenOptions];

/** Every call an open makes, by the sink it reached. */
function opener() {
  const calls: Call[] = [];
  const open = (address: string, asked?: OpenOptions) => {
    openAddressBy(address, asked, {
      loadHere: (url) => calls.push(["load here", url]),
      openPage: (url, options) => calls.push(["open page", url, options]),
      openScreen: (href, options) => calls.push(["open screen", href, options]),
      visitHere: (href) => calls.push(["visit here", href]),
    });
  };
  return { calls, open };
}

const click = (keys: Partial<MouseEvent> = {}) =>
  ({
    altKey: false,
    button: 0,
    ctrlKey: false,
    metaKey: false,
    preventDefault: () => {},
    shiftKey: false,
    ...keys,
  }) as MouseEvent; // A click's keys alone, which is all the handlers read.

/** What each gesture on the bar asks for, past a plain click. */
const GESTURES: [
  string,
  (handlers: ReturnType<typeof bookmarkClicks>) => void,
  OpenOptions,
][] = [
  [
    "Cmd-click",
    (on) => on.onClick(click({ metaKey: true })),
    { behind: true, newTab: true },
  ],
  [
    "middle click",
    (on) => on.onAuxClick(click({ button: 1 })),
    { behind: true, newTab: true },
  ],
  [
    "Shift-click",
    (on) => on.onClick(click({ shiftKey: true })),
    { newTab: true },
  ],
];

describe.each(BOOKMARKS)(
  "a bookmark of a $kind",
  ({ address, kind, lands }) => {
    const isPage = kind === "page";

    it("takes over the tab it is clicked in on a plain click", () => {
      const { calls, open } = opener();
      bookmarkClicks(address, open).onClick(click());
      expect(calls).toEqual([[isPage ? "load here" : "visit here", lands]]);
    });

    it.each(GESTURES)("opens where a %s asks", (_name, gesture, options) => {
      const { calls, open } = opener();
      gesture(bookmarkClicks(address, open));
      expect(calls).toEqual([
        [isPage ? "open page" : "open screen", lands, options],
      ]);
    });

    it("opens where each of its menu's places asks", () => {
      const { result } = renderHook(() => useWindowPlaces());
      const { calls, open } = opener();
      const places = result.current((options) => {
        open(address, options);
      });
      for (const place of places) {
        place.run();
      }
      expect(places.map((place) => place.label)).toEqual([
        "Open in Split",
        "Open in New Tab",
        "Open in New Tab Group",
        "Open in New Window",
      ]);
      const sink = isPage ? "open page" : "open screen";
      expect(calls).toEqual([
        [sink, lands, { into: "split" }],
        [sink, lands, { newTab: true }],
        [sink, lands, { into: "group" }],
        [sink, lands, { into: "window" }],
      ]);
    });
  },
);

it("opens a page to a place in a file's page as that page", () => {
  const { calls, open } = opener();
  open("file:///Users/mac-user/Site/index.html#intro");
  expect(calls).toEqual([
    ["load here", "file:///Users/mac-user/Site/index.html#intro"],
  ]);
});

describe("openAllTabOf", () => {
  it.each(BOOKMARKS)("opens a $kind at the tab that shows it", (bookmark) => {
    const tab = openAllTabOf(bookmark.address);
    expect(tab?.kind === "page" ? tab.url : tab?.href).toBe(bookmark.lands);
  });
});

describe("bookmarksToOpen", () => {
  const STATE: Bookmarks = {
    bookmarks: [
      {
        folder: "work",
        id: "b",
        order: 1,
        title: "B",
        url: "https://b.example/",
      },
      {
        folder: "work",
        id: "a",
        order: 0,
        title: "A",
        url: "https://a.example/",
      },
      { id: "bar", order: 0, title: "Bar", url: "https://bar.example/" },
      {
        id: "loose",
        order: 0,
        root: OTHER_ROOT,
        title: "Loose",
        url: "https://loose.example/",
      },
      {
        folder: "trips",
        id: "t",
        order: 0,
        title: "T",
        url: "https://t.example/",
      },
    ],
    folders: [
      { id: "work", order: 1, title: "Work" },
      { id: "trips", order: 1, root: OTHER_ROOT, title: "Trips" },
      { id: "empty", order: 2, title: "Empty" },
    ],
  };
  const ids = (of: string) => bookmarksToOpen(STATE, of).map((each) => each.id);

  it.each([
    { has: ["a", "b"], of: "work" },
    { has: ["t"], of: "trips" },
    { has: [], of: "empty" },
    { has: [], of: "gone" },
    // A folder inside All Bookmarks keeps its own, as Chrome opens a folder's.
    { has: ["loose"], of: OTHER_ROOT },
  ])("opens $has from $of", ({ has, of }) => {
    expect(ids(of)).toEqual(has);
  });
});

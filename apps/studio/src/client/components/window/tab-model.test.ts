import { draftGroupOf } from "@/shared/drafts";
import {
  BROWSER_HREF,
  NEW_TAB_HREF,
  type WindowTab,
} from "@/client/atoms/window";
import { closeGroupTab, emptyTabsModel } from "@/client/lib/tabs-model";
import { fileHref } from "@/shared/computer-href";
import { TabIdSchema, TabsModelSchema } from "@/shared/tabs";
import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import {
  addScreen,
  besideOf,
  closedGroupTabOf,
  closeTab,
  dropGroup,
  focusSide,
  groupLayoutOf,
  isBlankNewTab,
  moveTabTo,
  moveToGroup,
  navigateScreen,
  openInGroup,
  openOrFocusScreen,
  openPage,
  type PageTab,
  type ScreenTab,
  pageNavigated,
  pageTakesOver,
  patchPage,
  putUpBack,
  raiseTab,
  reopenTab,
  reorderGroup,
  replaceTab,
  screenMoved,
  selectTab,
  stepTrail,
  stepVisit,
  selectedTabIn,
  titleAtNavigation,
  tabToScreen,
  visitScreen,
  upTabsIn,
  type WindowTabs,
} from "./tab-model";
import { stepOf, stepStackOf } from "./tab-steps";

const CHAT = StoreId.SessionSchema.parse("ses_01JAAAAAAAAAAAAAAAAAAAAAAA");
const OTHER = StoreId.SessionSchema.parse("ses_01JBBBBBBBBBBBBBBBBBBBBBBB");
const DRAFT = draftGroupOf("d1");

function screenTab(id: string, href: string, group: string): ScreenTab {
  return { group, href, id, kind: "screen" };
}

function pageTab(id: string, url: string, group: string): PageTab {
  return { group, id, kind: "page", openedAt: 0, url };
}

function windowOf(
  tabs: WindowTab[],
  activeByGroup: Record<string, string> = {},
): WindowTabs {
  return { activeByGroup, tabs };
}

/** What a state reads as: each group's tabs by id, the one up starred. */
function shape(state: WindowTabs) {
  const groups = [...new Set(state.tabs.map((tab) => tab.group ?? "-"))];
  return Object.fromEntries(
    groups.map((group) => [
      group,
      state.tabs
        .filter((tab) => (tab.group ?? "-") === group)
        .map((tab) =>
          selectedTabIn(state, group)?.id === tab.id ? `*${tab.id}` : tab.id,
        )
        .join(" "),
    ]),
  );
}

const THREE = windowOf([
  screenTab("a", "/apps", CHAT),
  screenTab("b", BROWSER_HREF, CHAT),
  screenTab("c", "/files", CHAT),
  screenTab("x", "/apps", OTHER),
]);

describe("selectedTabIn", () => {
  const ROOFER = ChatIdSchema.parse("2026-10-01-roofer");

  it.each([
    ["a group with none chosen has its first up", ROOFER, {}, "a"],
    ["a group has the tab chosen in it up", ROOFER, { [ROOFER]: "b" }, "b"],
    ["a draft's with none chosen has its first up", DRAFT, {}, "a"],
  ])("%s", (_case, group, activeByGroup, expected) => {
    const state = windowOf(
      [
        pageTab("a", "https://example.com/", group),
        pageTab("b", "https://example.org/", group),
      ],
      activeByGroup,
    );
    expect(selectedTabIn(state, group)?.id).toBe(expected);
  });
});

describe("selectTab", () => {
  it.each([
    ["a tab of its group", "b", { [CHAT]: "a *b c", [OTHER]: "*x" }],
    ["the tab already up", "a", { [CHAT]: "*a b c", [OTHER]: "*x" }],
    ["a tab of a group behind", "x", { [CHAT]: "*a b c", [OTHER]: "*x" }],
    ["no tab", "nope", { [CHAT]: "*a b c", [OTHER]: "*x" }],
  ])("brings up %s", (_case, id, expected) => {
    expect(shape(selectTab(THREE, id))).toEqual(expected);
  });
});

describe("closeTab", () => {
  it.each([
    ["the tab up gives way to the one before it", "c", "c", "a *b"],
    ["the first tab up gives way to the next", "a", "a", "*b c"],
    ["a tab behind leaves the one up", "c", "b", "a *c"],
    ["a group's last tab leaves it empty", "only", "only", ""],
  ])("%s", (_case, up, closing, expected) => {
    const state =
      closing === "only"
        ? windowOf([screenTab("only", "/apps", CHAT)])
        : selectTab(THREE, up);
    const closed = closeTab(state, closing);
    expect(shape(closed)[CHAT] ?? "").toBe(expected);
  });

  it.each([
    ["a draft's", DRAFT],
    ["a chat's", ChatIdSchema.parse("2026-10-01-roofer")],
  ])("leaves %s group with no tab once its last closes", (_case, group) => {
    const state = selectTab(
      windowOf([pageTab("p", "https://example.com", group)]),
      "p",
    );
    const closed = closeTab(state, "p");
    expect(closed.tabs).toEqual([]);
    expect(closed.activeByGroup).toEqual({});
  });

  it("forgets what a closed group had up", () => {
    const state = selectTab(
      windowOf([screenTab("only", "/apps", CHAT)]),
      "only",
    );
    expect(closeTab(state, "only").activeByGroup).toEqual({});
  });
});

describe("moveToGroup", () => {
  it.each([
    ["the tab up hands its place to the one before it", "c", "c", "b"],
    ["the first tab up hands it to the next", "a", "a", "b"],
    ["a tab behind leaves the one up", "c", "b", "c"],
  ])("%s", (_case, up, moving, left) => {
    const moved = moveToGroup(selectTab(THREE, up), moving, OTHER);
    expect(moved.activeByGroup[CHAT]).toBe(left);
    expect(moved.tabs.find((tab) => tab.id === moving)?.group).toBe(OTHER);
  });

  it("forgets what a group had up once its last tab leaves", () => {
    const state = selectTab(
      windowOf([screenTab("only", "/apps", CHAT)]),
      "only",
    );
    expect(moveToGroup(state, "only", OTHER).activeByGroup).toEqual({});
  });
});

describe("openOrFocusScreen", () => {
  const FILE = "/Users/me/notes/plan.md";

  it.each([
    [
      "brings up the screen tab already at the address",
      { href: BROWSER_HREF, isWaiting: false, select: true },
      { [CHAT]: "a *b c", [OTHER]: "*x" },
      "b",
    ],
    [
      "leaves a tab found behind when not asked to bring it up",
      { href: BROWSER_HREF, isWaiting: true, select: false },
      { [CHAT]: "*a b c", [OTHER]: "*x" },
      "b",
    ],
    [
      "opens a tab beside the rest at an address none is at",
      { href: "/tasks?chat=x", isWaiting: false, select: true },
      { [CHAT]: "a b c *new", [OTHER]: "*x" },
      "new",
    ],
    [
      "opens one behind when not asked to bring it up",
      { href: "/tasks?chat=x", isWaiting: true, select: false },
      { [CHAT]: "*a b c new", [OTHER]: "*x" },
      "new",
    ],
  ])("%s", (_case, ask, expected, id) => {
    const opened = openOrFocusScreen(THREE, { ...ask, group: CHAT, id: "new" });
    expect(opened.id).toBe(id);
    expect(shape(opened.state)).toEqual(expected);
  });

  it.each([
    [
      "a file whose tab has settled its layout",
      fileHref(FILE),
      `${fileHref(FILE)}&view=columns&select=plan.md`,
    ],
    [
      "a folder whose tab has a selection",
      "/files?path=&root=%2FUsers%2Fme%2Fnotes",
      "/files?path=&root=%2FUsers%2Fme%2Fnotes&select=plan.md&view=list",
    ],
    ["a task", "/tasks/s1?chat=c1", "/tasks/s1"],
  ])("finds the tab already showing %s", (_, href, walked) => {
    const state = windowOf([
      screenTab("a", BROWSER_HREF, CHAT),
      screenTab("b", walked, CHAT),
    ]);
    const opened = openOrFocusScreen(state, {
      group: CHAT,
      href,
      id: "new",
      isWaiting: false,
      select: true,
    });
    expect(opened.id).toBe("b");
    expect(shape(opened.state)).toEqual({ [CHAT]: "a *b" });
  });

  it("finds a file's tab that became the page showing the file", () => {
    const state = windowOf([pageTab("p", `file://${FILE}`, CHAT)]);
    const opened = openOrFocusScreen(state, {
      group: CHAT,
      href: fileHref(FILE),
      id: "new",
      isWaiting: false,
      select: true,
    });
    expect(opened.id).toBe("p");
    expect(opened.state.tabs).toHaveLength(1);
  });

  it("tells a group waiting behind with its new tab up where to go, in that tab", () => {
    const state = windowOf([
      {
        ...screenTab("home", NEW_TAB_HREF, DRAFT),
        history: { entries: ["/browser", NEW_TAB_HREF], index: 1 },
      },
    ]);
    const opened = openOrFocusScreen(state, {
      group: DRAFT,
      href: "/apps",
      id: "new",
      isWaiting: true,
      select: true,
    });
    expect(opened.id).toBe("home");
    expect(opened.state.tabs).toEqual([
      {
        future: [],
        group: DRAFT,
        href: "/apps",
        id: "home",
        isOpened: false,
        kind: "screen",
      },
    ]);
  });
});

describe("a screen tab's own history", () => {
  const folder = "/files?path=notes%2F&root=~";
  const file = fileHref("/Users/me/notes/plan.md");

  it("walks on, back, and nowhere past its start", () => {
    const walked = visitScreen(
      windowOf([screenTab("t", folder, CHAT)]),
      "t",
      file,
    );
    expect(walked.tabs[0]).toMatchObject({
      href: file,
      history: { entries: [folder, file], index: 1 },
    });
    const back = stepTrail(walked, "t", -1);
    expect(back.href).toBe(folder);
    expect(back.state.tabs[0]).toMatchObject({
      history: { entries: [folder, file], index: 0 },
      href: folder,
    });
    expect(stepTrail(back.state, "t", -1).href).toBeUndefined();
    // Somewhere new from a step back drops what was ahead.
    const elsewhere = visitScreen(back.state, "t", "/apps");
    expect(elsewhere.tabs[0]).toMatchObject({
      history: { entries: [folder, "/apps"], index: 1 },
    });
  });

  it("follows its router, and changes nothing when the router is where the tab is", () => {
    const state = windowOf([screenTab("t", folder, CHAT)]);
    const moved = screenMoved(state, "t", {
      history: { entries: [folder, file], index: 1 },
      href: file,
    });
    expect(moved.tabs[0]).toMatchObject({ href: file });
    expect(
      screenMoved(moved, "t", {
        history: { entries: [folder, file], index: 1 },
        href: file,
      }),
    ).toBe(moved);
  });

  it("stays put at the address it already stands on, however it is spelled", () => {
    const state = windowOf([screenTab("t", "/files?root=~&path=", CHAT)]);
    expect(visitScreen(state, "t", "/files?path=&root=%7E")).toBe(state);
  });
});

describe("crossing between a page and a screen", () => {
  it("turns the page up into a screen, and back into the same page", () => {
    const page = pageTab("guest", "https://example.com", CHAT);
    const onScreen = navigateScreen(windowOf([page]), {
      group: CHAT,
      href: "/files",
      id: "screen",
    });
    expect(onScreen.tabs).toHaveLength(1);
    expect(onScreen.tabs[0]).toMatchObject({
      href: "/files",
      kind: "screen",
      stripKey: "guest",
    });
    const back = stepVisit(onScreen, "screen", -1);
    expect(back.state.tabs[0]).toMatchObject({ id: "guest", kind: "page" });
    const forward = stepVisit(back.state, "guest", 1);
    expect(forward.state.tabs[0]).toMatchObject({
      href: "/files",
      kind: "screen",
    });
  });

  it("sends a page tab named by its id to a screen, the page a step back", () => {
    const page = pageTab("guest", "https://example.com", CHAT);
    const other = screenTab("beside", "/apps", CHAT);
    const onScreen = tabToScreen(windowOf([page, other]), {
      href: "/files?path=&root=%7E%2FDocuments",
      id: "guest",
      newId: "screen",
    });
    expect(onScreen.tabs[0]).toMatchObject({
      href: "/files?path=&root=%7E%2FDocuments",
      id: "screen",
      kind: "screen",
    });
    expect(onScreen.tabs[1]).toBe(other);
    expect(stepVisit(onScreen, "screen", -1).state.tabs[0]).toMatchObject({
      id: "guest",
      kind: "page",
    });
  });

  it("keeps a step up in its group behind the one on screen", () => {
    const state = selectTab(
      windowOf([
        screenTab("one", "/apps", DRAFT),
        pageTab("two", "https://example.com", DRAFT),
      ]),
      "two",
    );
    const onScreen = navigateScreen(state, {
      group: DRAFT,
      href: "/files",
      id: "files",
    });
    const back = stepVisit(onScreen, "files", -1).state;
    expect(shape(back)).toEqual({ [DRAFT]: "one *two" });
  });
});

describe("openPage", () => {
  const PAGE = { id: "p", openedAt: 0, url: "https://example.com" };

  it("takes a tab's place, under its strip key, as what its group has up", () => {
    const opened = openPage(THREE, {
      group: undefined,
      page: PAGE,
      replacing: THREE.tabs[1],
      select: false,
    });
    expect(shape(opened)).toEqual({ [CHAT]: "a *p c", [OTHER]: "*x" });
    expect(opened.tabs[1]).toMatchObject({ kind: "page", stripKey: "b" });
    expect(opened.tabs[1]?.past?.map((visit) => visit.id)).toEqual(["b"]);
  });

  it.each([
    ["up when asked", true, { [CHAT]: "*a b c", [OTHER]: "x *p" }],
    ["behind otherwise", false, { [CHAT]: "*a b c", [OTHER]: "*x p" }],
  ])("joins a group with nothing behind it, %s", (_case, select, expected) => {
    const opened = openPage(THREE, { group: OTHER, page: PAGE, select });
    expect(shape(opened)).toEqual(expected);
    const stack = stepStackOf(opened.tabs.at(-1), {
      guest: { canGoBack: false, canGoForward: false },
    });
    expect(stepOf(stack, "back")).toBeUndefined();
  });

  it("lands right after the tab named", () => {
    const opened = openPage(THREE, {
      after: "a",
      group: CHAT,
      page: PAGE,
      select: false,
    });
    expect(shape(opened)).toEqual({ [CHAT]: "*a p b c", [OTHER]: "*x" });
  });
});

describe("addScreen", () => {
  it.each([
    ["at the group's end", undefined, "*a b c d"],
    ["right after the tab named", "a", "*a d b c"],
  ])("opens a screen %s", (_case, after, expected) => {
    const opened = addScreen(THREE, {
      after,
      group: CHAT,
      href: "/files",
      id: "d",
      select: false,
    });
    expect(shape(opened)[CHAT]).toBe(expected);
  });
});

describe("a page announcing itself", () => {
  const state = windowOf([
    { ...pageTab("p", "https://a.example", CHAT), title: "A" },
  ]);

  it.each([
    ["the same title", { title: "A" }, true],
    ["a new title", { title: "B" }, false],
    ["its icon gone", { favicon: undefined }, true],
  ])(
    "with %s changes the tabs only when something differs",
    (_case, changes, same) => {
      expect(patchPage(state, "p", changes) === state).toBe(same);
    },
  );

  it.each([
    ["a new document at another address", true, "https://b.example", undefined],
    ["a reload of the same address", true, "https://a.example", "a.example"],
    ["a move inside the document", false, "https://b.example", "a.example"],
  ])(
    "keeps the guest's title through %s only when it is the page's",
    (_case, isNewDocument, url, title) => {
      expect(
        titleAtNavigation({
          guestTitle: "a.example",
          isNewDocument,
          url,
          was: "https://a.example",
        }),
      ).toBe(title);
    },
  );

  it("drops what was ahead of a page that went somewhere new", () => {
    const ahead = windowOf([
      {
        ...pageTab("p", "https://a.example", CHAT),
        future: [screenTab("f", "/apps", CHAT)],
      },
    ]);
    expect(pageNavigated(ahead, "p").tabs[0]?.future).toEqual([]);
    expect(pageNavigated(state, "p")).toBe(state);
    expect(
      pageNavigated(state, "p", "https://b.example").tabs[0],
    ).toMatchObject({
      url: "https://b.example",
    });
  });
});

describe("dropGroup", () => {
  it("drops a group and what it had up, and changes nothing for a group it never had", () => {
    const state = selectTab(THREE, "x");
    expect(shape(dropGroup(state, OTHER))).toEqual({ [CHAT]: "*a b c" });
    expect(dropGroup(state, OTHER).activeByGroup).toEqual({});
    expect(dropGroup(state, "nobody")).toBe(state);
  });
});

describe("reorderGroup", () => {
  it.each([
    ["every tab named", ["c", "a", "b"], "c a b"],
    ["some tabs named, as one side's strip names them", ["c", "a"], "c b a"],
    ["a tab the group lacks named", ["c", "z"], "a b c"],
  ])("with %s", (_case, keys, expected) => {
    const order = reorderGroup(THREE, CHAT, keys)
      .tabs.filter((tab) => tab.group === CHAT)
      .map((tab) => tab.id)
      .join(" ");
    expect(order).toBe(expected);
  });
});

describe("reopenTab", () => {
  it.each([
    ["first", 0, "*r a b c"],
    ["between", 1, "a *r b c"],
    ["last", 3, "a b c *r"],
    ["past the tabs left", 9, "a b c *r"],
  ])("puts a tab back %s in its group, up", (_case, index, expected) => {
    const state = reopenTab(THREE, {
      index,
      tab: screenTab("r", "/apps", CHAT),
    });
    expect(shape(state)[CHAT]).toBe(expected);
    expect(shape(state)[OTHER]).toBe("*x");
  });

  it("puts a tab back in a group with none left", () => {
    const state = reopenTab(windowOf([screenTab("x", "/apps", OTHER)]), {
      index: 2,
      tab: screenTab("r", "/apps", CHAT),
    });
    expect(shape(state)).toEqual({ [CHAT]: "*r", [OTHER]: "*x" });
  });
});

describe("closeGroupTab", () => {
  it("keeps a group's tab on the window's closed list through what the window keeps", () => {
    const tab = { ...pageTab("p", "https://example.com/", CHAT), past: [] };
    const closed = closeGroupTab(emptyTabsModel(), {
      id: TabIdSchema.parse("closed"),
      index: 2,
      pathname: `/chats/${CHAT}`,
      tab,
    });
    const kept = TabsModelSchema.parse(
      JSON.parse(JSON.stringify(closed)),
    ).recentlyClosed;
    expect(kept.map((entry) => entry.index)).toEqual([2]);
    expect(kept.map(closedGroupTabOf)).toEqual([tab]);
  });

  it("reads no group's tab from a closed tab of the window's own", () => {
    expect(closedGroupTabOf({})).toBeUndefined();
    expect(closedGroupTabOf({ groupTab: { id: "p" } })).toBeUndefined();
  });

  it.each([
    ["a new tab", screenTab("n", NEW_TAB_HREF, DRAFT), true],
    [
      "a new tab come back from a page",
      {
        ...screenTab("n", NEW_TAB_HREF, DRAFT),
        past: [pageTab("p", "", DRAFT)],
      },
      false,
    ],
    ["a folder", screenTab("f", "/files", DRAFT), false],
  ])("counts %s as blank: %s", (_case, tab, isBlank) => {
    expect(isBlankNewTab(tab)).toBe(isBlank);
  });
});

describe("replaceTab", () => {
  it("keeps the tab's place, its group, and whether it was up", () => {
    const state = selectTab(THREE, "b");
    const replaced = replaceTab(state, "b", {
      group: undefined,
      href: "/files",
      id: "b2",
      kind: "screen",
    });
    expect(shape(replaced)).toEqual({ [CHAT]: "a *b2 c", [OTHER]: "*x" });
  });
});

describe("pageTakesOver", () => {
  const FOLDER = "/Users/casey/site";
  const FILE = `${FOLDER}/a.html`;
  const fileScreen = fileHref(FILE, { tree: FOLDER });
  const folderScreen = `/files?path=&root=${encodeURIComponent(FOLDER)}`;

  // The page's own record still names the file when the page moves on: what
  // the tab stands on is the address the page went to, and back from there
  // is the file, not the folder the file was opened from.
  it("puts the page in the tab's place at the address it went to, with the file behind it", () => {
    const next = pageTakesOver(
      windowOf(
        [
          {
            group: CHAT,
            href: fileScreen,
            id: "finder",
            kind: "screen",
            history: { entries: [folderScreen, fileScreen], index: 1 },
          },
          pageTab("page", `file://${FILE}`, "page:finder"),
        ],
        { [CHAT]: "finder" },
      ),
      { page: "page", tab: "finder", url: "https://example.com/" },
    );
    expect(shape(next)).toEqual({ [CHAT]: "*page" });
    const [tab] = next.tabs;
    expect(tab).toMatchObject({
      group: CHAT,
      id: "page",
      kind: "page",
      stripKey: "finder",
      url: "https://example.com/",
    });
    expect(tab?.past?.at(-1)).toMatchObject({
      history: { entries: [folderScreen, fileScreen], index: 1 },
      href: fileScreen,
    });
  });
});

/**
 * A group's sides as they read: each side's tabs by id with its up one
 * starred, the side with the keyboard led by `>`.
 */
function sidesOf(state: WindowTabs, group: string) {
  const layout = groupLayoutOf(state, group);
  return layout.sides.map(
    (side, index) =>
      (index === layout.focused ? "> " : "") +
      side.tabs
        .map((tab) => (tab.id === side.up ? `*${tab.id}` : tab.id))
        .join(" "),
  );
}

const GROUP = "group:1";
const ROOFER = ChatIdSchema.parse("2026-10-01-roofer");

/** One group of two sides: a and b on the left, the chat c and d on the right, the keyboard there on c. */
function twoSides(): WindowTabs {
  return {
    activeByGroup: { [GROUP]: "c" },
    besideByGroup: { [GROUP]: "b" },
    tabs: [
      screenTab("a", "/apps", GROUP),
      screenTab("b", "/files", GROUP),
      { ...screenTab("c", `/chats/${ROOFER}`, GROUP), side: 1 },
      { ...screenTab("d", BROWSER_HREF, GROUP), side: 1 },
    ],
  };
}

describe("a group's sides", () => {
  it("reads one side with its first tab up, and two with an up each", () => {
    expect(sidesOf(windowOf(THREE.tabs), CHAT)).toEqual(["> *a b c"]);
    expect(sidesOf(twoSides(), GROUP)).toEqual(["a *b", "> *c d"]);
  });

  it("names the tab up across from a tab, and none in a group of one side", () => {
    expect(besideOf(twoSides(), "d")?.id).toBe("b");
    expect(besideOf(twoSides(), "a")?.id).toBe("c");
    expect(besideOf(windowOf(THREE.tabs), "a")).toBeUndefined();
  });

  it("opens a tab right after the one named, on its side", () => {
    const opened = openInGroup(twoSides(), screenTab("n", "/apps", GROUP), {
      after: "a",
      group: GROUP,
      select: true,
    });
    expect(sidesOf(opened, GROUP)).toEqual(["> a *n b", "*c d"]);
  });

  it("opens on the side with the keyboard when no tab is named, behind unless chosen", () => {
    const opened = openInGroup(twoSides(), screenTab("n", "/apps", GROUP), {
      group: GROUP,
    });
    expect(sidesOf(opened, GROUP)).toEqual(["a *b", "> *c d n"]);
  });

  it("makes the second side for a tab opened on the other side of a group of one", () => {
    const opened = openInGroup(
      windowOf(THREE.tabs),
      screenTab("n", "/apps", CHAT),
      { after: "a", group: CHAT, select: true, side: "other" },
    );
    expect(sidesOf(opened, CHAT)).toEqual(["*a b c", "> *n"]);
  });

  it("moves a tab to the other side and back, a side it empties closing", () => {
    const moved = moveTabTo(windowOf(THREE.tabs), {
      group: CHAT,
      id: "c",
      select: true,
      side: 1,
    });
    expect(sidesOf(moved, CHAT)).toEqual(["*a b", "> *c"]);
    const back = moveTabTo(moved, { group: CHAT, id: "c", side: 0 });
    expect(sidesOf(back, CHAT)).toEqual(["> *a b c"]);
  });

  it.each([
    ["its own group's tab", "c", ["> *c", "*a b"]],
    ["another group's tab", "x", ["> *x", "*a b c"]],
  ])("makes a left side of %s, the others moving right", (_, id, sides) => {
    const split = moveTabTo(THREE, {
      group: CHAT,
      id,
      select: true,
      side: 0,
      split: true,
    });
    expect(sidesOf(split, CHAT)).toEqual(sides);
  });

  it.each([false, true])(
    "marks a tab moved from another group with that group, and keeps it within one (split %s)",
    (split) => {
      const moved = moveTabTo(THREE, { group: CHAT, id: "x", side: 0, split });
      const tab = moved.tabs.find((each) => each.id === "x");
      expect(tab?.movedFrom).not.toBeUndefined();
      expect(tab?.movedFrom).not.toBe(CHAT);
      const within = moveTabTo(moved, { group: CHAT, id: "x", side: 1 });
      expect(within.tabs.find((each) => each.id === "x")?.movedFrom).toBe(
        tab?.movedFrom,
      );
    },
  );

  it("moves a tab within its side to a place", () => {
    const moved = moveTabTo(twoSides(), {
      group: GROUP,
      id: "d",
      index: 0,
      side: 1,
    });
    expect(sidesOf(moved, GROUP)).toEqual(["a *b", "> d *c"]);
  });

  it("leaves the other side whole when a side's last tab closes", () => {
    const closed = closeTab(closeTab(twoSides(), "a"), "b");
    expect(sidesOf(closed, GROUP)).toEqual(["> *c d"]);
  });

  it("moves the keyboard to the other side, its tab up with it", () => {
    expect(sidesOf(focusSide(twoSides(), GROUP, 0), GROUP)).toEqual([
      "> a *b",
      "*c d",
    ]);
  });

  it("puts each side's tab up back, and the keyboard on its side, as a canceled drag does", () => {
    const before = twoSides();
    const up = upTabsIn(before, GROUP);
    // The other side's tab up with the keyboard, then its neighbor.
    const moved = selectTab(selectTab(before, "a"), "d");
    expect(sidesOf(moved, GROUP)).toEqual(["*a b", "> c *d"]);
    expect(sidesOf(putUpBack(moved, GROUP, up), GROUP)).toEqual([
      "a *b",
      "> *c d",
    ]);
  });

  it("leaves a tab closed since closed, and changes nothing without the keyboard's tab", () => {
    const up = upTabsIn(twoSides(), GROUP);
    const besideGone = closeTab(selectTab(twoSides(), "d"), "b");
    expect(sidesOf(putUpBack(besideGone, GROUP, up), GROUP)).toEqual([
      "*a",
      "> *c d",
    ]);
    const activeGone = closeTab(twoSides(), "c");
    expect(putUpBack(activeGone, GROUP, up)).toBe(activeGone);
  });

  it("raises a tab on the side without the keyboard and leaves the keyboard where it is", () => {
    expect(sidesOf(raiseTab(twoSides(), "a"), GROUP)).toEqual([
      "*a b",
      "> *c d",
    ]);
  });
});

describe("a chat's tab sent somewhere else", () => {
  const PAGE = { id: "p", openedAt: 0, url: "https://lighthouse.test/" };

  it("keeps the chat, and a page opens right after it, up", () => {
    const state = twoSides();
    const opened = openPage(state, {
      group: GROUP,
      page: PAGE,
      replacing: state.tabs[2],
      select: false,
    });
    expect(sidesOf(opened, GROUP)).toEqual(["a *b", "> c *p d"]);
    expect(opened.tabs.find((tab) => tab.id === "p")?.past).toBeUndefined();
  });

  it.each([
    [
      "sent there",
      (state: WindowTabs) =>
        tabToScreen(state, { href: "/history", id: "c", newId: "h" }),
    ],
    [
      "up as a screen is opened in place",
      (state: WindowTabs) =>
        navigateScreen(state, { group: GROUP, href: "/history", id: "h" }),
    ],
  ])(
    "keeps the chat, and a screen %s opens right after it, up",
    (_case, send) => {
      const opened = send(twoSides());
      expect(sidesOf(opened, GROUP)).toEqual(["a *b", "> c *h d"]);
      expect(opened.tabs.find((tab) => tab.id === "c")).toEqual(
        twoSides().tabs[2],
      );
    },
  );

  it("stays as it is, sent to its own chat", () => {
    const state = twoSides();
    expect(
      tabToScreen(state, { href: `/chats/${ROOFER}`, id: "c", newId: "h" }),
    ).toBe(state);
  });
});

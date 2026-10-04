import {
  BROWSER_HREF,
  draftGroupOf,
  NEW_TAB_HREF,
  type WindowTab,
} from "@/client/atoms/window";
import { fileHref } from "@/shared/computer-href";
import { StoreId } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import {
  adoptGroup,
  closeTab,
  dropGroup,
  navigateScreen,
  normalizeWindowTabs,
  openOrFocusScreen,
  openPage,
  type PageTab,
  type ScreenTab,
  pageNavigated,
  pageTakesOver,
  patchPage,
  reorderGroup,
  replaceTab,
  screenMoved,
  selectTab,
  stepTrail,
  stepVisit,
  upIn,
  visitScreen,
  type WindowTabs,
} from "./tab-model";

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
          upIn(state, group)?.id === tab.id ? `*${tab.id}` : tab.id,
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

describe("normalizeWindowTabs", () => {
  it("makes the tab the group on screen had up that group's, and drops what an earlier build kept beside it", () => {
    const read = normalizeWindowTabs({
      activeByGroup: { [OTHER]: "x" },
      activeId: "b",
      group: CHAT,
      previousGroup: OTHER,
      tabs: THREE.tabs,
    });
    expect(read).toEqual({
      activeByGroup: { [CHAT]: "b", [OTHER]: "x" },
      tabs: THREE.tabs,
    });
  });

  it("reads a screen's trail, and where it stood on it, as its history", () => {
    const read = normalizeWindowTabs({
      tabs: [
        {
          at: 0,
          group: CHAT,
          href: "/files",
          id: "s",
          kind: "screen",
          trail: ["/files", "/apps"],
        },
      ],
    });
    expect(read.tabs).toEqual([
      {
        group: CHAT,
        history: { entries: ["/files", "/apps"], index: 0 },
        href: "/files",
        id: "s",
        kind: "screen",
      },
    ]);
  });

  it("reads nothing kept as no tabs", () => {
    expect(normalizeWindowTabs({})).toEqual({ activeByGroup: {}, tabs: [] });
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
    const closed = closeTab(state, closing, { homeId: "home" });
    expect(shape(closed)[CHAT] ?? "").toBe(expected);
  });

  it("puts a draft's new tab back in place of its last, up", () => {
    const state = windowOf([pageTab("p", "https://example.com", DRAFT)]);
    const closed = closeTab(state, "p", { homeId: "home" });
    expect(shape(closed)).toEqual({ [DRAFT]: "*home" });
    expect(closed.tabs[0]).toMatchObject({ href: NEW_TAB_HREF });
  });

  it("forgets what a closed group had up", () => {
    const state = selectTab(
      windowOf([screenTab("only", "/apps", CHAT)]),
      "only",
    );
    expect(closeTab(state, "only", { homeId: "home" }).activeByGroup).toEqual(
      {},
    );
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
      homeId: "home",
      page: PAGE,
      replacing: THREE.tabs[1],
      select: false,
    });
    expect(shape(opened)).toEqual({ [CHAT]: "a *p c", [OTHER]: "*x" });
    expect(opened.tabs[1]).toMatchObject({ kind: "page", stripKey: "b" });
  });

  it.each([
    ["up when asked", true, { [CHAT]: "*a b c", [OTHER]: "x *p" }],
    ["behind otherwise", false, { [CHAT]: "*a b c", [OTHER]: "*x p" }],
  ])(
    "joins a group with a new tab behind it, %s",
    (_case, select, expected) => {
      const opened = openPage(THREE, {
        group: OTHER,
        homeId: "home",
        page: PAGE,
        select,
      });
      expect(shape(opened)).toEqual(expected);
      expect(opened.tabs.at(-1)?.past).toEqual([
        { href: BROWSER_HREF, id: "home", kind: "screen" },
      ]);
    },
  );
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

describe("groups handed over and dropped", () => {
  it("hands a draft's tabs to a chat, the one up still up, beside what the chat already had", () => {
    const state = selectTab(
      windowOf([
        screenTab("early", "/discover", OTHER),
        screenTab("d-apps", "/apps", DRAFT),
        screenTab("d-files", "/files", DRAFT),
      ]),
      "d-files",
    );
    const adopted = adoptGroup(state, DRAFT, OTHER);
    expect(shape(adopted)).toEqual({ [OTHER]: "early d-apps *d-files" });
    expect(adopted.activeByGroup).not.toHaveProperty(DRAFT);
  });

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
    ["a tab left out", ["c", "a"], "a b c"],
  ])("with %s", (_case, keys, expected) => {
    const order = reorderGroup(THREE, CHAT, keys)
      .tabs.filter((tab) => tab.group === CHAT)
      .map((tab) => tab.id)
      .join(" ");
    expect(order).toBe(expected);
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

import { describe, expect, it } from "vitest";

import { NEW_TAB_HREF } from "@/client/atoms/window";
import { handOnOpener, NO_OPENERS } from "./tab-openers";
import {
  addPages,
  addScreen,
  backToOpenerOf,
  closeTab,
  groupLayoutOf,
  moveTabTo,
  openPage,
  type PageTab,
  patchPage,
  pickTab,
  selectTab,
  startedOver,
  type WindowTabs,
} from "./tab-model";

const GROUP = "group";
const page = (id: string): PageTab => ({
  group: GROUP,
  // Short, so a strip reads at a glance; a real id is a prefixed ULID.
  id: id as PageTab["id"],
  kind: "page",
  openedAt: 0,
  url: `https://example.com/${id}`,
});
const pageOf = (id: string) => ({ ...page(id), group: GROUP });
const strip = (ids: string, up: string): WindowTabs => ({
  activeByGroup: { [GROUP]: up },
  tabs: ids.split(" ").map((id) => page(id)),
});
/** A side's tabs in order, the one up starred. */
const read = (state: WindowTabs, side: 0 | 1 = 0) => {
  const at = groupLayoutOf(state, GROUP).sides[side];
  return at?.tabs
    .map((tab) => (tab.id === at.up ? `*${tab.id}` : tab.id))
    .join(" ");
};
const front = (state: WindowTabs, id: string, tab: string) =>
  openPage(state, {
    after: tab,
    from: { reason: "link", tab },
    group: GROUP,
    page: pageOf(id),
    select: true,
  });
const behind = (state: WindowTabs, id: string, tab: string) =>
  addPages(state, [pageOf(id)], {
    after: tab,
    from: { reason: "link", tab },
  });
const newTab = (state: WindowTabs, id: string) =>
  addScreen(state, {
    from: { reason: "newTab" },
    group: GROUP,
    href: NEW_TAB_HREF,
    id,
    select: true,
  });

describe("where a link opens", () => {
  it("is after the links already opened behind the tab, in order", () => {
    let state = strip("a p z", "p");
    for (const id of ["1", "2", "3"]) {
      state = behind(state, id, "p");
    }
    expect(read(state)).toBe("a *p 1 2 3 z");
  });
  it("is after what those links opened too", () => {
    let state = behind(strip("p z", "p"), "1", "p");
    state = behind(pickTab(state, "1"), "1a", "1");
    expect(read(behind(pickTab(state, "p"), "2", "p"))).toBe("*p 1 1a 2 z");
  });
  it("is right after the tab once the person went to a tab of no relation", () => {
    let state = behind(strip("a p z", "p"), "1", "p");
    state = pickTab(pickTab(pickTab(state, "1"), "a"), "p");
    expect(read(behind(state, "2", "p"))).toBe("a *p 2 1 z");
  });
  it("is right after the tab in front", () => {
    expect(read(front(strip("p z", "p"), "1", "p"))).toBe("p *1 z");
  });
});

describe("what comes up as a tab closes", () => {
  const opened = () =>
    behind(behind(behind(strip("a p z", "p"), "1", "p"), "2", "p"), "3", "p");
  it.each([
    ["a plain tab: its right neighbor", strip("a b c", "b"), "b", "a *c"],
    ["a last plain tab: its left", strip("a b", "b"), "b", "*a"],
    ["a tab behind: the same one", strip("a b c", "c"), "a", "b *c"],
    [
      "a link in front: where it was",
      front(strip("a p z", "p"), "1", "p"),
      "1",
      "a *p z",
    ],
    [
      "a new tab: where it was made",
      newTab(strip("a p z", "a"), "n"),
      "n",
      "*a p z",
    ],
    [
      "a link behind, gone to: the next one",
      pickTab(opened(), "1"),
      "1",
      "a p *2 3 z",
    ],
    [
      "the last link: the one before",
      pickTab(opened(), "3"),
      "3",
      "a p 1 *2 z",
    ],
    ["the page they came from: the first", opened(), "p", "a *1 2 3 z"],
  ])("%s", (_name, state, id, expected) => {
    expect(read(closeTab(state, id))).toBe(expected);
  });
  it("works through the links and back to the page", () => {
    let state = pickTab(opened(), "1");
    for (const id of ["1", "2", "3"]) {
      state = closeTab(state, id);
    }
    expect(read(state)).toBe("a *p z");
  });
  it("hands a closed tab's links on to what opened it", () => {
    let state = front(strip("a p z", "p"), "1", "p");
    state = behind(state, "1a", "1");
    state = closeTab(state, "1");
    expect(read(state)).toBe("a p *1a z");
    expect(read(closeTab(state, "1a"))).toBe("a *p z");
  });
  it("never leaves a tab its own opener", () => {
    const links = {
      ...NO_OPENERS,
      openers: { a: { opener: "b" }, b: { opener: "a" } },
    };
    expect(handOnOpener(links, page("b")).openers).toEqual({});
  });
  it("is the neighbor after a switch away from a new tab and back", () => {
    let state = newTab(strip("a p", "a"), "n");
    state = pickTab(pickTab(state, "a"), "n");
    expect(read(closeTab(state, "n"))).toBe("a *p");
  });
  it("is the neighbor after a switch to a tab of no relation", () => {
    let state = front(strip("a p z", "p"), "1", "p");
    state = pickTab(pickTab(state, "a"), "1");
    expect(read(closeTab(state, "1"))).toBe("a p *z");
  });
  it("is where it was after the tab it came from was looked at", () => {
    let state = front(strip("a p z", "p"), "1", "p");
    state = pickTab(pickTab(state, "p"), "1");
    expect(read(closeTab(state, "1"))).toBe("a *p z");
  });
  it("goes by links an app's own selecting of a tab never forgets", () => {
    let state = front(strip("a p z", "p"), "1", "p");
    state = selectTab(selectTab(state, "a"), "1");
    expect(read(closeTab(state, "1"))).toBe("a *p z");
  });
  it("is the neighbor once the person went to an address of their own", () => {
    const state = startedOver(front(strip("a p z", "p"), "1", "p"), "1");
    expect(read(closeTab(state, "1"))).toBe("a p *z");
  });
  it("is where a new tab was made after its first look-up", () => {
    const state = startedOver(newTab(strip("a p", "a"), "n"), "n");
    expect(read(closeTab(state, "n"))).toBe("*a p");
  });
  it("stays on the side", () => {
    let state = moveTabTo(strip("a b c", "a"), {
      group: GROUP,
      id: "c",
      select: true,
      side: 1,
    });
    state = openPage(state, {
      from: { reason: "link", tab: "a" },
      group: GROUP,
      page: pageOf("r"),
      select: true,
      side: 1,
    });
    expect(read(closeTab(state, "r"), 1)).toBe("*c");
    expect(backToOpenerOf(state, "r")).toBeUndefined();
  });
  it("is by the links of a tab moved along its strip", () => {
    const state = moveTabTo(front(strip("a p z", "p"), "1", "p"), {
      group: GROUP,
      id: "1",
      index: 3,
      side: 0,
    });
    expect(read(closeTab(selectTab(state, "1"), "1"))).toBe("a *p z");
  });
});

describe("where Back returns past a tab's start", () => {
  it.each([
    ["the tab a link was in", front(strip("p z", "p"), "1", "p"), "p"],
    ["for a link opened behind", behind(strip("p z", "p"), "1", "p"), "p"],
    [
      "still, after looking at other tabs",
      pickTab(pickTab(front(strip("p z", "p"), "1", "p"), "z"), "1"),
      "p",
    ],
    [
      "nowhere once that tab went on",
      patchPage(front(strip("p z", "p"), "1", "p"), "p", {
        url: "https://example.com/p#on",
      }),
      undefined,
    ],
    [
      "nowhere once that tab closed",
      closeTab(front(strip("p z", "p"), "1", "p"), "p"),
      undefined,
    ],
    [
      "nowhere once that tab is on the other side",
      moveTabTo(front(strip("p z", "p"), "1", "p"), {
        group: GROUP,
        id: "p",
        side: 1,
      }),
      undefined,
    ],
    ["nowhere for a new tab", newTab(strip("p", "p"), "1"), undefined],
    [
      "nowhere for a copy",
      openPage(strip("p", "p"), {
        after: "p",
        from: { reason: "asked", tab: "p" },
        group: GROUP,
        page: pageOf("1"),
        select: true,
      }),
      undefined,
    ],
  ])("%s", (_name, state, expected) => {
    expect(backToOpenerOf(state, "1")?.id).toBe(expected);
  });
  it("brings that tab up in its place", () => {
    const state = front(strip("a p z", "p"), "1", "p");
    const { id: up } = backToOpenerOf(state, "1") ?? {};
    expect(read(closeTab(state, "1", { up }))).toBe("a *p z");
  });
});

import {
  closedTabsAtom,
  NEW_TAB_HREF,
  THREADS_HREF,
  type WindowTab,
  type WindowTabs,
  windowTabsAtom,
} from "@/client/atoms/orchestrator";
import { StoreId } from "@instrument-org/workspace/client";
import { useAtom, useSetAtom } from "jotai";

import { stepTabVisit, visitInTab } from "./tab-history";

/** The route that shows nothing of its own: what the router is at while a page is on screen. */
export const PAGE_ROUTE = "/orchestrator/browser";

/** The key the window's own group is remembered under, since it has no thread to be named by. */
const WINDOW_GROUP = "window";

/**
 * Whether a tab is its thread's anchor: the thread's own screen, which is
 * always in its group, first, and never closed. Everything else in the group
 * was opened while the thread was on screen.
 */
export function isAnchor(tab: WindowTab): boolean {
  return (
    tab.kind === "screen" &&
    tab.group !== undefined &&
    threadOfHref(tab.href) === tab.group
  );
}

/** A screen tab's address, taken apart: the route and its search. */
export function parseHref(href: string) {
  const url = new URL(href, "http://tabs");
  return { pathname: url.pathname, search: url.searchParams };
}

/**
 * The tabs with one of them on screen, in its own group: choosing a tab of
 * another group is moving to that group, with the group being left
 * remembering what it had up.
 */
export function selectTab(current: WindowTabs, id: string): WindowTabs {
  const tab = current.tabs.find((entry) => entry.id === id);
  if (!tab) {
    return current;
  }
  return { ...current, ...movingTo(current, tab.group), activeId: id };
}

/** The thread whose screen an address is, if it is one. */
export function threadOfHref(href: string): StoreId.Session | undefined {
  const { pathname } = parseHref(href);
  if (!pathname.startsWith(`${THREADS_HREF}/`)) {
    return undefined;
  }
  const id = StoreId.SessionSchema.safeParse(
    pathname.slice(THREADS_HREF.length + 1).replace(/\/$/, ""),
  );
  return id.success ? id.data : undefined;
}

/** Takes the tab closed last off the pile, for whoever can bring it back. */
export function usePopClosedTab() {
  const [closed, setClosed] = useAtom(closedTabsAtom);
  return (): undefined | WindowTab => {
    const tab = closed.at(-1);
    if (tab) {
      setClosed((current) => current.slice(0, -1));
    }
    return tab;
  };
}

/**
 * The window's tabs, in groups: every thread has a group of its own with the
 * thread's screen as its anchor, and the window has one for what is opened
 * outside any thread. One group is on screen at a time; its tabs are what
 * the strip shows and what `tabs` here lists, while the other groups keep
 * what they have for when their thread comes back. Pages and screens are one
 * list; where the router goes when a tab is selected is the layout's
 * business, which watches `activeId`.
 */
export function useWindowTabs() {
  const [state, setTabs] = useAtom(windowTabsAtom);
  const { activeId, group, tabs: allTabs } = state;
  const setClosed = useSetAtom(closedTabsAtom);
  const tabs = allTabs.filter((tab) => tab.group === group);
  const active =
    tabs.find((tab) => tab.id === activeId && tab.group === group) ?? tabs[0];

  const select = (id: string) => {
    setTabs((current) => selectTab(current, id));
  };

  /**
   * Shows a thread: its group comes on screen, at the tab it last had up, or
   * at its anchor when it is the group already on screen, since asking for
   * the thread again is asking for the conversation. The anchor is made the
   * first time, at the head of the group.
   */
  const showThread = (sessionId: StoreId.Session) => {
    setTabs((current) => {
      const href = `${THREADS_HREF}/${sessionId}`;
      let anchor = current.tabs.find(
        (tab) => tab.group === sessionId && isAnchor(tab),
      );
      let next = current.tabs;
      if (!anchor) {
        anchor = {
          at: 0,
          group: sessionId,
          href,
          id: `screen-${crypto.randomUUID()}`,
          kind: "screen",
          trail: [href],
        };
        const first = next.findIndex((tab) => tab.group === sessionId);
        next =
          first === -1
            ? [...next, anchor]
            : [...next.slice(0, first), anchor, ...next.slice(first)];
      }
      const remembered = current.activeByGroup?.[sessionId];
      const resumeAt =
        current.group !== sessionId &&
        remembered !== undefined &&
        next.some((tab) => tab.id === remembered)
          ? remembered
          : anchor.id;
      // Already there: the same state, so nothing downstream re-reads it.
      if (
        next === current.tabs &&
        current.group === sessionId &&
        current.activeId === resumeAt
      ) {
        return current;
      }
      return {
        ...current,
        ...movingTo(current, sessionId),
        activeId: resumeAt,
        tabs: next,
      };
    });
  };

  /** Opens a screen at an address in the group on screen, and shows it. */
  const openScreen = (href: string, { isOpened = false } = {}) => {
    const thread = threadOfHref(href);
    if (thread) {
      showThread(thread);
      return;
    }
    const id = `screen-${crypto.randomUUID()}`;
    setTabs((current) => ({
      ...current,
      activeId: id,
      tabs: [
        ...current.tabs,
        {
          at: 0,
          group: current.group,
          href,
          id,
          isOpened,
          kind: "screen",
          trail: [href],
        },
      ],
    }));
    return id;
  };

  /** Shows the screen tab of this group already at that address, or opens one there. */
  const openOrFocusScreen = (href: string, { isOpened = false } = {}) => {
    const existing = tabs.find(
      (tab) => tab.kind === "screen" && sameHref(tab.href, href),
    );
    if (existing) {
      select(existing.id);
      return existing.id;
    }
    return openScreen(href, { isOpened });
  };

  /** Shows the window's own group, at the tab it last had up, or at a new tab when it has none. */
  const showWindow = () => {
    setTabs((current) => {
      const own = current.tabs.filter((tab) => tab.group === undefined);
      const remembered = current.activeByGroup?.[WINDOW_GROUP];
      const resumeAt =
        remembered !== undefined && own.some((tab) => tab.id === remembered)
          ? remembered
          : own[0]?.id;
      if (resumeAt !== undefined) {
        return {
          ...current,
          ...movingTo(current, undefined),
          activeId: resumeAt,
        };
      }
      const fresh = `screen-${crypto.randomUUID()}`;
      return {
        ...current,
        ...movingTo(current, undefined),
        activeId: fresh,
        tabs: [
          ...current.tabs,
          { href: NEW_TAB_HREF, id: fresh, kind: "screen" },
        ],
      };
    });
  };

  /**
   * Where the screen tab on screen is now: the router moved inside it.
   *
   * The address joins the tab's trail, and anything that was ahead of it is
   * dropped, the way a browser drops the forward stack when you go somewhere
   * new. Arriving at the address the trail is already standing on is a step
   * taken by back or forward, so it moves nothing. An anchor never moves:
   * what the thread's screen was sent to opens as a tab beside it instead.
   */
  const setActiveHref = (href: string) => {
    const thread = threadOfHref(href);
    if (thread) {
      showThread(thread);
      return;
    }
    setTabs((current) => {
      const tab = current.tabs.find((entry) => entry.id === current.activeId);
      if (tab?.kind !== "screen" || sameHref(tab.href, href)) {
        return current;
      }
      if (isAnchor(tab)) {
        const id = `screen-${crypto.randomUUID()}`;
        return {
          ...current,
          activeId: id,
          tabs: [
            ...current.tabs,
            {
              at: 0,
              group: tab.group,
              href,
              id,
              isOpened: true,
              kind: "screen",
              trail: [href],
            },
          ],
        };
      }
      const trail = tab.trail ?? [tab.href];
      const at = tab.at ?? trail.length - 1;
      return {
        ...current,
        tabs: current.tabs.map((entry) =>
          entry.id === tab.id
            ? {
                ...entry,
                at: at + 1,
                future: [],
                href,
                trail: [...trail.slice(0, at + 1), href],
              }
            : entry,
        ),
      };
    });
  };

  /** Puts a different tab in one's place, keeping where it sits in the strip and whose group it is in. */
  const replace = (id: string, next: WindowTab) => {
    setTabs((current) => {
      const replaced = current.tabs.find((tab) => tab.id === id);
      const tab = { ...next, group: next.group ?? replaced?.group };
      return {
        ...current,
        activeId: current.activeId === id ? tab.id : current.activeId,
        tabs: current.tabs.map((entry) => (entry.id === id ? tab : entry)),
      };
    });
  };

  const navigateScreen = (href: string) => {
    const thread = threadOfHref(href);
    if (thread) {
      showThread(thread);
    } else if (active?.kind === "page") {
      replace(
        active.id,
        visitInTab(active, {
          at: 0,
          href,
          id: `screen-${crypto.randomUUID()}`,
          kind: "screen",
          trail: [href],
        }),
      );
    } else {
      setActiveHref(href);
    }
  };

  const stepVisit = (direction: -1 | 1) => {
    const next = active && stepTabVisit(active, direction);
    if (next) replace(active.id, next);
    return next;
  };

  /**
   * A step along the active tab's own trail, or nothing when it has none left.
   * The caller navigates to what comes back; this only moves the mark.
   */
  const step = (direction: -1 | 1): string | undefined => {
    if (active?.kind !== "screen") {
      return undefined;
    }
    const trail = active.trail ?? [active.href];
    const next = (active.at ?? trail.length - 1) + direction;
    const href = trail[next];
    if (href === undefined) {
      return undefined;
    }
    setTabs((current) => ({
      ...current,
      tabs: current.tabs.map((tab) =>
        tab.id === active.id ? { ...tab, at: next, href } : tab,
      ),
    }));
    return href;
  };

  /** Closes a tab, never an anchor: a thread's group always has its thread. */
  const close = (id: string) => {
    const closing = allTabs.find((tab) => tab.id === id);
    if (!closing || isAnchor(closing)) {
      return;
    }
    if (closing.kind === "screen" || closing.url) {
      setClosed((current) => [...current, closing]);
    }
    // Off the list as it is at that moment, so a tab opened since is kept.
    setTabs((current) => {
      const index = current.tabs.findIndex((tab) => tab.id === id);
      if (index === -1) {
        return current;
      }
      const remaining = current.tabs.filter((tab) => tab.id !== id);
      const own = remaining.filter((tab) => tab.group === current.group);
      // The window's last tab closing leaves a new tab in its place: the
      // window is never empty, and an empty list would only reopen the
      // screen the router is still at. A thread's group keeps its anchor.
      if (own.length === 0 && current.group === undefined) {
        const fresh = `screen-${crypto.randomUUID()}`;
        return {
          ...current,
          activeId: fresh,
          tabs: [
            ...remaining,
            { href: NEW_TAB_HREF, id: fresh, kind: "screen" },
          ],
        };
      }
      if (current.activeId !== id) {
        return { ...current, tabs: remaining };
      }
      // The neighbor before it within its group, or the group's first.
      const before = current.tabs
        .slice(0, index)
        .findLast((tab) => tab.group === current.group);
      return {
        ...current,
        activeId: before?.id ?? own[0]?.id ?? null,
        tabs: remaining,
      };
    });
  };

  return {
    active,
    activeId,
    /** Every tab of every group, for whoever holds something per tab rather than per strip. */
    allTabs,
    close,
    closeActive: () => {
      if (active) {
        close(active.id);
      }
    },
    // Back is either a step along this tab's trail, or, at the start of a tab
    // something else opened, closing it: a tab opened to show one thing is
    // done when you have gone back past the thing.
    canStepBack:
      active?.kind === "screen" &&
      (atOf(active) > 0 || Boolean(active.isOpened)),
    canStepForward:
      active?.kind === "screen" && atOf(active) < trailOf(active).length - 1,
    /** The thread whose group is on screen, or nothing for the window's own. */
    group,
    navigateScreen,
    openOrFocusScreen,
    openScreen,
    /** The group's tabs in a new order; the anchor stays first whatever the order says. */
    reorder: (keys: string[]) => {
      setTabs((current) => {
        const own = current.tabs.filter((tab) => tab.group === current.group);
        const ordered = keys.flatMap((key) => {
          const tab = own.find((entry) => (entry.stripKey ?? entry.id) === key);
          return tab ? [tab] : [];
        });
        if (ordered.length !== own.length) {
          return current;
        }
        const anchorAt = ordered.findIndex((tab) => isAnchor(tab));
        const withAnchorFirst =
          anchorAt > 0
            ? [
                ...ordered.slice(anchorAt, anchorAt + 1),
                ...ordered.slice(0, anchorAt),
                ...ordered.slice(anchorAt + 1),
              ]
            : ordered;
        let next = 0;
        return {
          ...current,
          tabs: current.tabs.map((tab) =>
            tab.group === current.group
              ? (withAnchorFirst[next++] ?? tab)
              : tab,
          ),
        };
      });
    },
    replace,
    select,
    selectIndex: (index: number) => {
      const tab = index >= 9 ? tabs.at(-1) : tabs[index - 1];
      if (tab) {
        select(tab.id);
      }
    },
    selectRelative: (direction: -1 | 1) => {
      const at = tabs.findIndex((tab) => tab.id === active?.id);
      const next = tabs[(at + direction + tabs.length) % tabs.length];
      if (next) {
        select(next.id);
      }
    },
    setActiveHref,
    showThread,
    showWindow,
    step,
    stepVisit,
    /** The tabs of the group on screen, in strip order. */
    tabs,
  };
}

function atOf(tab: undefined | WindowTab) {
  return tab?.kind === "screen" ? (tab.at ?? trailOf(tab).length - 1) : 0;
}

/**
 * What changes when another group comes on screen: the group being left
 * remembers the tab it had up, so coming back lands where it left off.
 */
function movingTo(
  current: WindowTabs,
  group: string | undefined,
): Pick<WindowTabs, "activeByGroup" | "group"> {
  if (group === current.group) {
    return { group };
  }
  return {
    activeByGroup: {
      ...current.activeByGroup,
      ...(current.activeId === null
        ? {}
        : { [current.group ?? WINDOW_GROUP]: current.activeId }),
    },
    group,
  };
}

/** Two addresses are one screen when the route and every search entry agree, however either was encoded. */
function sameHref(a: string, b: string) {
  const [x, y] = [parseHref(a), parseHref(b)];
  if (x.pathname.replace(/\/$/, "") !== y.pathname.replace(/\/$/, "")) {
    return false;
  }
  return searchEntries(x.search) === searchEntries(y.search);
}

function searchEntries(search: URLSearchParams) {
  return [...search.entries()].sort().join("&");
}

/** Where a screen tab has been, and where along it the tab is standing. */
function trailOf(tab: undefined | WindowTab) {
  return tab?.kind === "screen" ? (tab.trail ?? [tab.href]) : [];
}

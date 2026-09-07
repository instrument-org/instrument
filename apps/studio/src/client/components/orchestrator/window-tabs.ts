import {
  closedTabsAtom,
  NEW_TAB_HREF,
  type WindowTab,
  windowTabsAtom,
} from "@/client/atoms/orchestrator";
import { useAtom, useSetAtom } from "jotai";

/** The route that shows nothing of its own: what the router is at while a page is on screen. */
export const PAGE_ROUTE = "/orchestrator/browser";

/** A screen tab's address, taken apart: the route and its search. */
export function parseHref(href: string) {
  const url = new URL(href, "http://tabs");
  return { pathname: url.pathname, search: url.searchParams };
}

/** Two addresses are one screen when the route and every search entry agree, however either was encoded. */
export function sameHref(a: string, b: string) {
  const [x, y] = [parseHref(a), parseHref(b)];
  if (x.pathname.replace(/\/$/, "") !== y.pathname.replace(/\/$/, "")) {
    return false;
  }
  return searchEntries(x.search) === searchEntries(y.search);
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
 * The window's tabs: what is open, which is on screen, and the ways to change
 * that. Pages and screens are one list; where the router goes when a tab is
 * selected is the layout's business, which watches `activeId`.
 */
export function useWindowTabs() {
  const [{ activeId, tabs }, setTabs] = useAtom(windowTabsAtom);
  const setClosed = useSetAtom(closedTabsAtom);
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  const select = (id: string) => {
    setTabs((current) => ({ ...current, activeId: id }));
  };

  /** Opens a screen at an address and shows it. */
  const openScreen = (href: string, { isOpened = false } = {}) => {
    const id = `screen-${crypto.randomUUID()}`;
    setTabs((current) => ({
      activeId: id,
      tabs: [
        ...current.tabs,
        { at: 0, href, id, isOpened, kind: "screen", trail: [href] },
      ],
    }));
    return id;
  };

  /** Shows the screen tab already at that address, or opens one there. */
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

  /**
   * Where the screen tab on screen is now: the router moved inside it.
   *
   * The address joins the tab's trail, and anything that was ahead of it is
   * dropped, the way a browser drops the forward stack when you go somewhere
   * new. Arriving at the address the trail is already standing on is a step
   * taken by back or forward, so it moves nothing.
   */
  const setActiveHref = (href: string) => {
    setTabs((current) => ({
      ...current,
      tabs: current.tabs.map((tab) => {
        if (
          tab.id !== current.activeId ||
          tab.kind !== "screen" ||
          sameHref(tab.href, href)
        ) {
          return tab;
        }
        const trail = tab.trail ?? [tab.href];
        const at = tab.at ?? trail.length - 1;
        return {
          ...tab,
          at: at + 1,
          href,
          trail: [...trail.slice(0, at + 1), href],
        };
      }),
    }));
  };

  /** Puts a different tab in one's place, keeping where it sits in the strip. */
  const replace = (id: string, next: WindowTab) => {
    setTabs((current) => ({
      activeId: current.activeId === id ? next.id : current.activeId,
      tabs: current.tabs.map((tab) => (tab.id === id ? next : tab)),
    }));
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

  const close = (id: string) => {
    const closing = tabs.find((tab) => tab.id === id);
    if (closing && (closing.kind === "screen" || closing.url)) {
      setClosed((current) => [...current, closing]);
    }
    // Off the list as it is at that moment, so a tab opened since is kept.
    setTabs((current) => {
      const index = current.tabs.findIndex((tab) => tab.id === id);
      if (index === -1) {
        return current;
      }
      const remaining = current.tabs.filter((tab) => tab.id !== id);
      // The last tab closing leaves a new tab in its place, whatever it was:
      // the window is never empty, and an empty list would only reopen the
      // screen the router is still at.
      if (remaining.length === 0) {
        const fresh = `screen-${crypto.randomUUID()}`;
        return {
          activeId: fresh,
          tabs: [{ href: NEW_TAB_HREF, id: fresh, kind: "screen" }],
        };
      }
      return {
        activeId:
          current.activeId === id
            ? (remaining[Math.max(0, index - 1)]?.id ?? null)
            : current.activeId,
        tabs: remaining,
      };
    });
  };

  return {
    active,
    activeId,
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
    openOrFocusScreen,
    openScreen,
    reorder: (keys: string[]) => {
      setTabs((current) => ({
        ...current,
        tabs: keys.flatMap((key) => {
          const tab = current.tabs.find(
            (entry) => (entry.stripKey ?? entry.id) === key,
          );
          return tab ? [tab] : [];
        }),
      }));
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
    step,
    tabs,
  };
}

function atOf(tab: undefined | WindowTab) {
  return tab?.kind === "screen" ? (tab.at ?? trailOf(tab).length - 1) : 0;
}

function searchEntries(search: URLSearchParams) {
  return [...search.entries()].sort().join("&");
}

/** Where a screen tab has been, and where along it the tab is standing. */
function trailOf(tab: undefined | WindowTab) {
  return tab?.kind === "screen" ? (tab.trail ?? [tab.href]) : [];
}

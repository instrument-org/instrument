import {
  closedTabsAtom,
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
  const openScreen = (href: string) => {
    const id = `screen-${crypto.randomUUID()}`;
    setTabs((current) => ({
      activeId: id,
      tabs: [...current.tabs, { href, id, kind: "screen" }],
    }));
    return id;
  };

  /** Shows the screen tab already at that address, or opens one there. */
  const openOrFocusScreen = (href: string) => {
    const existing = tabs.find(
      (tab) => tab.kind === "screen" && sameHref(tab.href, href),
    );
    if (existing) {
      select(existing.id);
      return existing.id;
    }
    return openScreen(href);
  };

  /** Where the screen tab on screen is now: the router moved inside it. */
  const setActiveHref = (href: string) => {
    setTabs((current) => ({
      ...current,
      tabs: current.tabs.map((tab) =>
        tab.id === current.activeId &&
        tab.kind === "screen" &&
        tab.href !== href
          ? { ...tab, href }
          : tab,
      ),
    }));
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
    openOrFocusScreen,
    openScreen,
    reorder: (keys: string[]) => {
      setTabs((current) => ({
        ...current,
        tabs: keys.flatMap((key) => {
          const tab = current.tabs.find((entry) => entry.id === key);
          return tab ? [tab] : [];
        }),
      }));
    },
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
    tabs,
  };
}

function searchEntries(search: URLSearchParams) {
  return [...search.entries()].sort().join("&");
}

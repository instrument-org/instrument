import {
  CHATS_HREF,
  draftGroupOf,
  draftOfGroup,
  NEW_TAB_HREF,
  newTabHrefOf,
  type WindowTab,
  type WindowTabs,
  windowTabsAtom,
} from "@/client/atoms/orchestrator";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { StoreId } from "@instrument-org/workspace/client";
import { useAtom } from "jotai";

import { stepTabVisit, visitInTab } from "./tab-history";

export function atOf(tab: undefined | WindowTab) {
  return tab?.kind === "screen" ? (tab.at ?? trailOf(tab).length - 1) : 0;
}

/** The chat whose screen an address is, if it is one. */
export function chatOfHref(href: string): StoreId.Session | undefined {
  const { pathname } = parseHref(href);
  if (!pathname.startsWith(`${CHATS_HREF}/`)) {
    return undefined;
  }
  const id = StoreId.SessionSchema.safeParse(
    pathname.slice(CHATS_HREF.length + 1).replace(/\/$/, ""),
  );
  return id.success ? id.data : undefined;
}

/**
 * The chat an address names by the start of its id, among the chats the
 * window has.
 *
 * The agent's own listing prints a chat as the first characters of its id,
 * and a link written from that listing carries the same, so an address with
 * a whole id is one case of this rather than the only one. Case is ignored
 * the way the listing's own lookup ignores it. Exactly one chat starting
 * with it is the chat; none or several is no chat, since a link that
 * could mean two things should open neither.
 */
export function chatOfHrefPrefix(
  href: string,
  chats: Iterable<StoreId.Session>,
): StoreId.Session | undefined {
  const { pathname } = parseHref(href);
  if (!pathname.startsWith(`${CHATS_HREF}/`)) {
    return undefined;
  }
  const prefix = pathname
    .slice(CHATS_HREF.length + 1)
    .replace(/\/$/, "")
    .toLowerCase();
  if (!prefix) {
    return undefined;
  }
  const matches = [...chats].filter((id) =>
    id.toLowerCase().startsWith(prefix),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Whether a tab is still its group's own new tab, standing where it opened:
 * the page that reaches everything, a place's apps, or the computer at the
 * home folder. Such a tab is told where to go rather than kept beside what
 * was asked for; one that has walked somewhere is a tab of its own.
 */
export function isFreshTab(tab: WindowTab): boolean {
  return tab.kind === "screen" && sameHref(tab.href, newTabHrefOf(tab.group));
}

/** Whether a tab is the new-tab page: what a draft gathers from, and nothing gathered itself. */
export function isHomeTab(tab: WindowTab): boolean {
  return (
    tab.kind === "screen" &&
    parseHref(tab.href).pathname === parseHref(NEW_TAB_HREF).pathname
  );
}

/**
 * The tabs with a page drawn inside another tab (a file tab's page beside its
 * tree) taking that tab over: the page, guest and all, stands where the tab
 * stood, in its place in the strip and its group, and back from it returns
 * to what the tab showed. The page's own entry, in the group of pages drawn
 * inside tabs, goes.
 */
export function pageTakesOver(
  current: WindowTabs,
  { page: pageId, tab: tabId, url }: { page: string; tab: string; url: string },
): WindowTabs {
  const tab = current.tabs.find((entry) => entry.id === tabId);
  const page = current.tabs.find((entry) => entry.id === pageId);
  if (!tab || page?.kind !== "page") {
    return current;
  }
  const {
    future: _future,
    group: _group,
    isOpened: _opened,
    past: _past,
    stripKey: _key,
    ...visit
  } = page;
  // At the address the page went on to, which the page's own record may not
  // have caught up with yet.
  const next = visitInTab(tab, { ...visit, pageBackSteps: 0, url });
  return {
    ...current,
    activeByGroup:
      tab.group !== undefined && current.activeByGroup?.[tab.group] === tabId
        ? { ...current.activeByGroup, [tab.group]: pageId }
        : current.activeByGroup,
    activeId: current.activeId === tabId ? pageId : current.activeId,
    tabs: current.tabs.flatMap((entry) =>
      entry.id === pageId ? [] : entry.id === tabId ? [next] : [entry],
    ),
  };
}

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

/** Where a screen tab has been, and where along it the tab is standing. */
export function trailOf(tab: undefined | WindowTab) {
  return tab?.kind === "screen" ? (tab.trail ?? [tab.href]) : [];
}

/**
 * The window's tabs, in groups: every chat has a group of its own, keyed
 * by its session, and every draft one under its key. One group is on screen
 * at a time, or none; its tabs are what the strip shows and what `tabs` here
 * lists, while the other groups keep what they have for when their chat
 * comes back. A group may hold no tabs at all: the chat or the draft
 * stands over the tabs rather than among them. Pages and screens are one
 * list; where the router goes when a tab is selected is the layout's
 * business, which watches `activeId`.
 */
export function useWindowTabs() {
  const [state, setTabs] = useAtom(windowTabsAtom);
  const { activeId, group, tabs: allTabs } = state;
  const tabs =
    group === undefined ? [] : allTabs.filter((tab) => tab.group === group);
  const active =
    tabs.find((tab) => tab.id === activeId && tab.group === group) ?? tabs[0];

  const select = (id: string) => {
    setTabs((current) => selectTab(current, id));
  };

  /**
   * Shows a group: it comes on screen at the tab it last had up, or at its
   * first tab, or at none. Asking for the group already on screen changes
   * nothing: the chat is over its tabs whichever of them is up.
   */
  const showGroup = (key: string) => {
    setTabs((current) => {
      if (current.group === key) {
        return current;
      }
      const own = current.tabs.filter((tab) => tab.group === key);
      const remembered = current.activeByGroup?.[key];
      const resumeAt =
        remembered !== undefined && own.some((tab) => tab.id === remembered)
          ? remembered
          : (own[0]?.id ?? null);
      return { ...current, ...movingTo(current, key), activeId: resumeAt };
    });
  };

  const showChat = (sessionId: StoreId.Session) => {
    showGroup(sessionId);
  };

  const showDraft = (draftId: string) => {
    showGroup(draftGroupOf(draftId));
  };

  /**
   * Makes a tab the one its group has up: on screen when the group is the
   * one on screen, and otherwise remembered for the group, which is what a
   * host drawing that group's tabs somewhere else (the draft window) shows.
   */
  const selectIn = (key: string, id: string) => {
    setTabs((current) => {
      const tab = current.tabs.find((entry) => entry.id === id);
      if (!tab || tab.group !== key) {
        return current;
      }
      if (key === current.group) {
        return { ...current, activeId: id };
      }
      return {
        ...current,
        activeByGroup: { ...current.activeByGroup, [key]: id },
      };
    });
  };

  /**
   * Opens a screen at an address: in the group on screen and shown, or in
   * the group named, behind whatever is up, when that group is not the one
   * on screen. A group that has nothing yet is made by the tab landing in it,
   * so a chat that has not been opened still gets what was opened for it.
   * `activate` makes the tab the one a group behind has up, for a host that
   * draws that group's tabs itself.
   */
  const openScreen = (
    href: string,
    {
      activate = false,
      group: into,
      isOpened = false,
    }: { activate?: boolean; group?: string; isOpened?: boolean } = {},
  ) => {
    const chat = chatOfHref(href);
    if (chat) {
      showChat(chat);
      return;
    }
    const id = `screen-${crypto.randomUUID()}`;
    setTabs((current) => {
      const key = into ?? current.group;
      if (key === undefined) {
        return current;
      }
      const shown = key === current.group;
      return {
        ...current,
        activeId: shown ? id : current.activeId,
        ...(!shown && activate
          ? { activeByGroup: { ...current.activeByGroup, [key]: id } }
          : {}),
        tabs: [
          ...current.tabs,
          {
            at: 0,
            group: key,
            href,
            id,
            isOpened,
            kind: "screen",
            trail: [href],
          },
        ],
      };
    });
    return id;
  };

  /**
   * The tab a group has up: the one it last showed, or its first, which is
   * the tab the group comes on screen at; the tab on screen for the group
   * that is.
   */
  const tabUpIn = (key: string | undefined): undefined | WindowTab => {
    if (key === undefined) {
      return undefined;
    }
    if (key === group) {
      return active;
    }
    const own = allTabs.filter((tab) => tab.group === key);
    return own.find((tab) => tab.id === state.activeByGroup?.[key]) ?? own[0];
  };

  /** The new-tab page a group has up, when that is what it has up. */
  const newTabUpIn = (key: string | undefined): undefined | WindowTab => {
    const up = tabUpIn(key);
    return up && isHomeTab(up) ? up : undefined;
  };

  /**
   * Shows the screen tab already at that address, in the group on screen or
   * the group named, or opens one there. A file's tab may have become the
   * page that shows the file; it is still the file's tab, and the file is not
   * opened twice. Told to show it, the group comes on screen at the tab,
   * rather than keeping it behind.
   */
  const openOrFocusScreen = (
    href: string,
    {
      activate = false,
      group: into,
      isOpened = false,
      show = false,
    }: {
      activate?: boolean;
      group?: string;
      isOpened?: boolean;
      show?: boolean;
    } = {},
  ) => {
    const key = into ?? group;
    const filePath = parseHref(href).search.get("file") ?? undefined;
    const existing = allTabs.find(
      (tab) =>
        tab.group === key &&
        (tab.kind === "screen"
          ? sameHref(tab.href, href)
          : filePath !== undefined && hostPathOfFileUrl(tab.url) === filePath),
    );
    if (existing) {
      if (show || key === group) {
        select(existing.id);
      } else if (activate && key !== undefined) {
        selectIn(key, existing.id);
      }
      return existing.id;
    }
    // A group waiting behind with its new tab up is told where to go, the
    // way the tab on screen is: the screen lands in that tab rather than
    // beside it. The tab keeps its id, so what remembered it still finds it.
    const fresh = key === group ? undefined : newTabUpIn(key);
    if (fresh) {
      setTabs((current) => ({
        ...current,
        tabs: current.tabs.map((tab) =>
          tab.id === fresh.id
            ? { ...tab, at: 0, future: [], href, isOpened, trail: [href] }
            : tab,
        ),
      }));
      if (show) {
        select(fresh.id);
      } else if (activate && key !== undefined) {
        selectIn(key, fresh.id);
      }
      return fresh.id;
    }
    const id = openScreen(href, { activate, group: into, isOpened });
    if (show && id !== undefined) {
      select(id);
    }
    return id;
  };

  /**
   * Where a screen tab is now, by the tab: the screen inside it moved. The
   * address joins the tab's trail and drops what was ahead of it, the way
   * `setActiveHref` does for the tab on screen; a tab drawn by another host
   * (the draft window) is told this way, since the router never follows it.
   */
  const visitHref = (id: string, href: string) => {
    setTabs((current) => {
      const tab = current.tabs.find((entry) => entry.id === id);
      if (tab?.kind !== "screen" || sameHref(tab.href, href)) {
        return current;
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

  /**
   * Where the screen tab on screen is now: the router moved inside it.
   *
   * The address joins the tab's trail, and anything that was ahead of it is
   * dropped, the way a browser drops the forward stack when you go somewhere
   * new. Arriving at the address the trail is already standing on is a step
   * taken by back or forward, so it moves nothing.
   */
  const setActiveHref = (href: string) => {
    const chat = chatOfHref(href);
    if (chat) {
      showChat(chat);
      return;
    }
    setTabs((current) => {
      const tab = current.tabs.find((entry) => entry.id === current.activeId);
      if (tab?.kind !== "screen" || sameHref(tab.href, href)) {
        return current;
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
    const chat = chatOfHref(href);
    if (chat) {
      showChat(chat);
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
   * A step between what a tab has shown (a page, a screen) rather than
   * inside one, for the tab named, whether or not it is on screen.
   */
  const stepVisitOf = (id: string, direction: -1 | 1) => {
    const tab = allTabs.find((entry) => entry.id === id);
    const next = tab && stepTabVisit(tab, direction);
    if (next) replace(id, next);
    return next;
  };

  /**
   * A step along a screen tab's own trail, or nothing when it has none left:
   * the address it steps to, which the tab now stands on. A tab drawn by
   * another host (the draft window) is stepped this way, since the router
   * never follows it.
   */
  const stepTab = (id: string, direction: -1 | 1): string | undefined => {
    const tab = allTabs.find((entry) => entry.id === id);
    if (tab?.kind !== "screen") {
      return undefined;
    }
    const next = atOf(tab) + direction;
    const href = trailOf(tab)[next];
    if (href === undefined) {
      return undefined;
    }
    setTabs((current) => ({
      ...current,
      tabs: current.tabs.map((entry) =>
        entry.id === id ? { ...entry, at: next, href } : entry,
      ),
    }));
    return href;
  };

  /**
   * A step along the active tab's own trail, or nothing when it has none left.
   * The caller navigates to what comes back; this only moves the mark.
   */
  const step = (direction: -1 | 1): string | undefined =>
    active ? stepTab(active.id, direction) : undefined;

  /**
   * Closes a tab. A chat's last tab closes like any other, and its pane
   * goes with it; a draft's or a place's last tab is replaced by its new
   * tab, since the draft is what is gathered beside the words and the page
   * is where gathering starts, and a place is nothing but its tabs.
   */
  const close = (id: string) => {
    const closing = allTabs.find((tab) => tab.id === id);
    if (!closing) {
      return;
    }
    // Off the list as it is at that moment, so a tab opened since is kept.
    setTabs((current) => {
      const index = current.tabs.findIndex((tab) => tab.id === id);
      if (index === -1) {
        return current;
      }
      const remaining = current.tabs.filter((tab) => tab.id !== id);
      const keepsOne = draftOfGroup(closing.group) !== undefined;
      if (keepsOne && !remaining.some((tab) => tab.group === closing.group)) {
        const href = newTabHrefOf(closing.group);
        const home: WindowTab = {
          at: 0,
          group: closing.group,
          href,
          id: `screen-${crypto.randomUUID()}`,
          kind: "screen",
          trail: [href],
        };
        return {
          ...current,
          activeId: current.activeId === id ? home.id : current.activeId,
          tabs: [...remaining.slice(0, index), home, ...remaining.slice(index)],
        };
      }
      if (current.activeId !== id) {
        return { ...current, tabs: remaining };
      }
      // The neighbor before it within its group, or the first left in the
      // group, or nothing.
      const before = current.tabs
        .slice(0, index)
        .findLast((tab) => tab.group === closing.group);
      return {
        ...current,
        activeId:
          before?.id ??
          remaining.find((tab) => tab.group === closing.group)?.id ??
          null,
        tabs: remaining,
      };
    });
  };

  /**
   * Hands a group over to a chat: what a draft gathered becomes the
   * chat's tabs exactly as they are, guests and all, the one up still up,
   * so starting the chat moves nothing under it. A tab already filed
   * under the chat (a task's browser that arrived before the start came
   * back) stays where it is, beside them. The chat's group comes on
   * screen, and the group handed over is gone, its remembered tab and all.
   * Told not to show it, the tabs move behind whatever is on screen and the
   * chat remembers the tab the draft had up, for a chat that floats.
   */
  const adoptGroup = (
    from: string,
    sessionId: StoreId.Session,
    { show = true }: { show?: boolean } = {},
  ) => {
    setTabs((current) => {
      const moved = current.tabs
        .filter((tab) => tab.group === from)
        .map((tab) => ({ ...tab, group: sessionId }));
      const rest = current.tabs.filter((tab) => tab.group !== from);
      const { [from]: left, ...activeByGroup } = current.activeByGroup ?? {};
      if (!show) {
        const remembered = left ?? activeByGroup[sessionId] ?? moved[0]?.id;
        return {
          ...current,
          activeByGroup:
            remembered === undefined
              ? activeByGroup
              : { ...activeByGroup, [sessionId]: remembered },
          ...(current.group === from
            ? { activeId: null, group: undefined }
            : {}),
          tabs: [...rest, ...moved],
        };
      }
      // Leaving the group being handed over is leaving nothing: what it had
      // up is what the chat has up, not a place to come back to.
      const leaving =
        current.group === from
          ? { ...current, activeByGroup, group: undefined }
          : { ...current, activeByGroup };
      return {
        ...current,
        ...movingTo(leaving, sessionId),
        activeId:
          current.group === from
            ? current.activeId
            : (left ??
              activeByGroup[sessionId] ??
              moved[0]?.id ??
              rest.find((tab) => tab.group === sessionId)?.id ??
              null),
        tabs: [...rest, ...moved],
      };
    });
  };

  /** Drops a group and everything in it, for a draft thrown away. */
  const dropGroup = (key: string) => {
    setTabs((current) => {
      const { [key]: _left, ...activeByGroup } = current.activeByGroup ?? {};
      const leaving = current.group === key;
      return {
        ...current,
        activeByGroup,
        ...(leaving ? { activeId: null, group: undefined } : {}),
        tabs: current.tabs.filter((tab) => tab.group !== key),
      };
    });
  };

  /** Puts the group on screen away: nothing is on screen until a group is asked for again. */
  /**
   * Drops a group and every tab in it, for a chat that no longer exists,
   * and puts it away when it is the one on screen.
   */
  const forgetGroup = (key: string) => {
    setTabs((current) => {
      const { [key]: _remembered, ...activeByGroup } =
        current.activeByGroup ?? {};
      const kept = current.tabs.filter((tab) => tab.group !== key);
      const previousGroup =
        current.previousGroup === key ? undefined : current.previousGroup;
      return current.group === key
        ? {
            ...current,
            activeByGroup,
            activeId: null,
            group: undefined,
            previousGroup,
            tabs: kept,
          }
        : { ...current, activeByGroup, previousGroup, tabs: kept };
    });
  };

  const leaveGroup = () => {
    setTabs((current) =>
      current.group === undefined
        ? current
        : { ...current, ...movingTo(current, undefined), activeId: null },
    );
  };

  return {
    active,
    activeId,
    adoptGroup,
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
    dropGroup,
    /** The group on screen, by the chat's session id or the draft's key, or nothing while none is. */
    forgetGroup,
    group,
    leaveGroup,
    /** A tab into a group of its own, standing there alone: a page drawn inside a tab becoming a site of the window's own. */
    moveToGroup: (id: string, key: string) => {
      setTabs((current) => ({
        ...current,
        tabs: current.tabs.map((tab) =>
          tab.id === id ? { ...tab, group: key } : tab,
        ),
      }));
    },
    navigateScreen,
    openOrFocusScreen,
    openScreen,
    /** A page drawn inside a tab takes that tab over; see `pageTakesOver`. */
    pageTakesOver: (page: string, tab: string, url: string) => {
      setTabs((current) => pageTakesOver(current, { page, tab, url }));
    },
    /** The group the one on screen took over from, for going back to it when the draft is put away. */
    previousGroup: state.previousGroup,
    /** A group's tabs in a new order: the group on screen's, or the group named. */
    reorder: (keys: string[], key?: string) => {
      setTabs((current) => {
        const groupKey = key ?? current.group;
        const own = current.tabs.filter((tab) => tab.group === groupKey);
        const ordered = keys.flatMap((stripKey) => {
          const tab = own.find(
            (entry) => (entry.stripKey ?? entry.id) === stripKey,
          );
          return tab ? [tab] : [];
        });
        if (ordered.length !== own.length) {
          return current;
        }
        let next = 0;
        return {
          ...current,
          tabs: current.tabs.map((tab) =>
            tab.group === groupKey ? (ordered[next++] ?? tab) : tab,
          ),
        };
      });
    },
    replace,
    select,
    selectIn,
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
    showChat,
    showDraft,
    showGroup,
    step,
    stepVisit,
    stepVisitOf,
    /** The tab a group has up, or would come on screen at. */
    tabUpIn,
    /** The tabs of the group on screen, in strip order. */
    stepTab,
    tabs,
    visitHref,
  };
}

/**
 * What changes when another group comes on screen: the group being left
 * remembers the tab it had up, so coming back lands where it left off, and
 * is remembered itself, so a draft put away can hand the screen back.
 */
function movingTo(
  current: WindowTabs,
  group: string | undefined,
): Pick<WindowTabs, "activeByGroup" | "group" | "previousGroup"> {
  if (group === current.group) {
    return {
      activeByGroup: current.activeByGroup,
      group,
      previousGroup: current.previousGroup,
    };
  }
  return {
    activeByGroup: {
      ...current.activeByGroup,
      ...(current.activeId === null || current.group === undefined
        ? {}
        : { [current.group]: current.activeId }),
    },
    group,
    previousGroup: current.group,
  };
}

function searchEntries(search: URLSearchParams) {
  return [...search.entries()].sort().join("&");
}

import {
  newTabHrefOf,
  type TabVisit,
  type WindowTab,
} from "@/client/atoms/window";
import { hostPathOfFileUrl } from "@/client/lib/file-url";

/**
 * Where a screen tab's router has been, oldest first, and where along it the
 * tab stands: only the address it is at, until it has moved.
 */
export function historyOf(tab: Extract<WindowTab, { kind: "screen" }>): {
  entries: string[];
  index: number;
} {
  return tab.history ?? { entries: [tab.href], index: 0 };
}

/**
 * Restore a visit while retaining its browser session or screen trail. A page
 * with nothing behind it has a new tab behind it: back from its start is the
 * page going back to being a new tab.
 */
export function stepTabVisit(
  current: WindowTab,
  direction: -1 | 1,
): undefined | WindowTab {
  const from =
    direction === 1
      ? current.future
      : current.kind === "page" && !current.past?.length
        ? [newTabVisit(current.group)]
        : current.past;
  const visit = from?.at(-1);
  if (!visit || !from) return undefined;
  return {
    ...visit,
    future:
      direction === 1
        ? from.slice(0, -1)
        : [...(current.future ?? []), visitOf(current)],
    // The tab stays the chat's whatever it steps to.
    group: current.group,
    isOpened: current.isOpened,
    past:
      direction === -1
        ? from.slice(0, -1)
        : [...(current.past ?? []), visitOf(current)],
    stripKey: current.stripKey ?? current.id,
  };
}

/** Navigate across the screen/browser boundary without adding a tab. */
export function visitInTab(current: WindowTab, visit: TabVisit): WindowTab {
  const previous = leftBehind(current, visit);
  return {
    ...visit,
    future: [],
    // The tab stays the chat's whatever it visits.
    group: current.group,
    isOpened: current.isOpened,
    past: [...(current.past ?? []), ...(previous ? [visitOf(previous)] : [])],
    stripKey: current.stripKey ?? current.id,
  };
}

/**
 * Whether a screen at that address shows nothing itself but hands its file to
 * the page arriving: the file view at exactly the page's file, asked for as
 * the page rather than as its text.
 */
function handsOff(href: string, visit: TabVisit): boolean {
  const filePath =
    visit.kind === "page" ? hostPathOfFileUrl(visit.url) : undefined;
  if (filePath === undefined) {
    return false;
  }
  const search = new URL(href, "http://tabs").searchParams;
  return search.get("file") === filePath && !search.has("source");
}

/**
 * What back from the arriving visit lands on: the tab as it stands, with
 * anything ahead of its mark dropped. A screen at a file the arriving page
 * shows is no stop of its own, since it exists only to hand the file to the
 * browser and would hand it over again the moment back showed it; back skips
 * it, to where the file was opened from, or past it when it began the tab.
 */
function leftBehind(
  current: WindowTab,
  visit: TabVisit,
): undefined | WindowTab {
  if (current.kind === "page") {
    return current;
  }
  const { entries, index } = historyOf(current);
  if (!handsOff(entries[index] ?? current.href, visit)) {
    return {
      ...current,
      history: { entries: entries.slice(0, index + 1), index },
    };
  }
  if (index <= 0) {
    return undefined;
  }
  return {
    ...current,
    history: { entries: entries.slice(0, index), index: index - 1 },
    href: entries[index - 1] ?? current.href,
  };
}

function newTabVisit(group: string | undefined): TabVisit {
  return {
    href: newTabHrefOf(group),
    id: `screen-${crypto.randomUUID()}`,
    kind: "screen",
  };
}

function visitOf(tab: WindowTab): TabVisit {
  const {
    future: _future,
    isOpened: _opened,
    past: _past,
    stripKey: _key,
    ...visit
  } = tab;
  return visit;
}

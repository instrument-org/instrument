import {
  NEW_TAB_HREF,
  type TabVisit,
  type WindowTab,
} from "@/client/atoms/orchestrator";
import { hostPathOfFileUrl } from "@/client/lib/file-url";

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
        ? [newTabVisit()]
        : current.past;
  const visit = from?.at(-1);
  if (!visit || !from) return undefined;
  return {
    ...visit,
    future:
      direction === 1
        ? from.slice(0, -1)
        : [...(current.future ?? []), visitOf(current)],
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
    // The tab stays the thread's whatever it visits.
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
    return { ...current, pageBackSteps: 0 };
  }
  if (!current.trail) {
    return current;
  }
  const at = current.at ?? current.trail.length - 1;
  if (!handsOff(current.trail[at] ?? current.href, visit)) {
    return { ...current, trail: current.trail.slice(0, at + 1) };
  }
  if (at <= 0) {
    return undefined;
  }
  return {
    ...current,
    at: at - 1,
    href: current.trail[at - 1] ?? current.href,
    trail: current.trail.slice(0, at),
  };
}

function newTabVisit(): TabVisit {
  return {
    href: NEW_TAB_HREF,
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

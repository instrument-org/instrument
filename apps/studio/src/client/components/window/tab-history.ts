import {
  NEW_TAB_HREF,
  type TabVisit,
  type WindowTab,
} from "@/client/atoms/window";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { StoreId } from "@instrument-org/workspace/client";

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

/** The id agents name a tab by: the one it opened with, kept through every visit since (`agentId`). */
export function agentIdOf(tab: Pick<WindowTab, "agentId" | "id">): string {
  return tab.agentId ?? tab.id;
}

/** The agent id `current` hands on to a visit with the id `id` in its place. */
function agentIdFor(current: WindowTab, id: string) {
  const agentId = agentIdOf(current);
  return agentId === id ? {} : { agentId };
}

/** A visit as the tab takes it up, with no agent id of its own: the tab's goes with it. */
function withoutAgentId({
  agentId: _agentId,
  ...visit
}: TabVisit & { agentId?: string }): TabVisit {
  return visit;
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
        ? [newTabVisit()]
        : current.past;
  const visit = from?.at(-1);
  if (!visit || !from) return undefined;
  return {
    ...withoutAgentId(visit),
    ...agentIdFor(current, visit.id),
    future:
      direction === 1
        ? from.slice(0, -1)
        : [...(current.future ?? []), visitOf(current)],
    // The tab stays in its group and on its side whatever it steps to.
    group: current.group,
    ...(current.side === undefined ? {} : { side: current.side }),
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
    ...withoutAgentId(visit),
    ...agentIdFor(current, visit.id),
    future: [],
    // The tab stays in its group and on its side whatever it visits.
    group: current.group,
    ...(current.side === undefined ? {} : { side: current.side }),
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

function newTabVisit(): TabVisit {
  return {
    href: NEW_TAB_HREF,
    id: StoreId.newTabId(),
    kind: "screen",
  };
}

function visitOf(tab: WindowTab): TabVisit {
  const {
    agentId: _agentId,
    future: _future,
    past: _past,
    side: _side,
    stripKey: _key,
    ...visit
  } = tab;
  return visit;
}

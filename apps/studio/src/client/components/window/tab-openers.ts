import { type WindowTab } from "@/client/atoms/window";

/**
 * Which tab each tab was opened from, after Chromium's `TabStripModel` and
 * `BackToOpenerController`: where the next link opened behind a tab lands,
 * what comes up as a tab closes, and where Back goes from the start of a tab
 * a link opened. A strip here is one side of a tab group, and every function
 * takes that side's tabs in order. Tabs are named by `openerKeyOf`, which a
 * tab keeps as it turns from a screen to a page.
 */
export interface TabOpeners {
  /** What a close goes by, dropped as the person starts on something else. */
  openers: Record<string, TabOpener>;
  /** What Back goes by, kept while the tab opened from stays where it was. */
  sources: Record<string, TabSource>;
}

interface TabOpener {
  /** A new tab's, which holds only until the person switches away from it. */
  once?: true;
  opener: string;
}

interface TabSource {
  /** The address the tab opened from stood at. */
  at: string;
  tab: string;
}

/**
 * Why the person opened a tab: a link followed from a tab, a copy of a tab or
 * something asked of the window while a tab was up (`asked`), or a new tab of
 * their own. Back returns only along a link. An open with no reason (an
 * agent's, a drop, a reopen) is linked to nothing.
 */
export type Opening =
  | { reason: "asked" | "link"; tab?: string }
  | { reason: "newTab"; tab?: never };

export const NO_OPENERS: TabOpeners = { openers: {}, sources: {} };

export function openerKeyOf(tab: WindowTab): string {
  return tab.stripKey ?? tab.id;
}

/** Where a tab stands, as its source's address is compared. */
export function addressOfTab(tab: WindowTab): string | undefined {
  return tab.kind === "screen" ? tab.href : (tab.url ?? tab.openedUrl);
}

/**
 * The tab up on a side once the one at `id` goes: the nearest it opened, else
 * the nearest opened from where it was, right before left in both; else the
 * one it was opened from, else its right neighbor, else its left.
 */
export function nextUpAfter(
  side: readonly WindowTab[],
  id: string,
  { openers }: TabOpeners,
): undefined | WindowTab {
  const at = side.findIndex((tab) => tab.id === id);
  const closing = side[at];
  if (!closing) {
    return undefined;
  }
  const outward = [...side.slice(at + 1), ...side.slice(0, at).toReversed()];
  const openedFrom = (key: string) =>
    outward.find((tab) => openers[openerKeyOf(tab)]?.opener === key);
  const opener = openers[openerKeyOf(closing)]?.opener;
  return (
    openedFrom(openerKeyOf(closing)) ??
    (opener === undefined
      ? undefined
      : (openedFrom(opener) ??
        outward.find((tab) => openerKeyOf(tab) === opener))) ??
    outward[0]
  );
}

/**
 * The tab the next link opened behind `id` goes right after: the last of the
 * unbroken run of tabs opened from it, or from those, else the tab itself.
 */
export function lastOpenedFrom(
  side: readonly WindowTab[],
  id: string,
  { openers }: TabOpeners,
): string {
  const at = side.findIndex((tab) => tab.id === id);
  const start = side[at];
  if (!start) {
    return id;
  }
  const family = new Set([openerKeyOf(start)]);
  let last = id;
  for (const tab of side.slice(at + 1)) {
    const opener = openers[openerKeyOf(tab)]?.opener;
    if (opener === undefined || !family.has(opener)) {
      break;
    }
    family.add(openerKeyOf(tab));
    last = tab.id;
  }
  return last;
}

/** With every opener on a side forgotten: the person started on something else. */
export function forgetOpeners(
  links: TabOpeners,
  side: readonly WindowTab[],
): TabOpeners {
  const keys = new Set(side.map(openerKeyOf));
  const kept = Object.entries(links.openers).filter(([key]) => !keys.has(key));
  return kept.length === Object.keys(links.openers).length
    ? links
    : { ...links, openers: Object.fromEntries(kept) };
}

/**
 * The person switched from one tab of a side to another: a new tab left
 * behind forgets its opener, and a switch to a tab of no relation forgets
 * every opener on the side.
 */
export function switchedTabs(
  links: TabOpeners,
  side: readonly WindowTab[],
  from: WindowTab,
  to: WindowTab,
): TabOpeners {
  const [fromKey, toKey] = [openerKeyOf(from), openerKeyOf(to)];
  if (fromKey === toKey) {
    return links;
  }
  const left = links.openers[fromKey];
  const come = links.openers[toKey]?.opener;
  if (come !== left?.opener && come !== fromKey && left?.opener !== toKey) {
    return forgetOpeners(links, side);
  }
  return left?.once === true ? withoutOpener(links, fromKey) : links;
}

/** A tab closed or taken off its side: what it opened is its opener's. */
export function handOnOpener(links: TabOpeners, gone: WindowTab): TabOpeners {
  const key = openerKeyOf(gone);
  const opener = links.openers[key]?.opener;
  const openers = Object.fromEntries(
    Object.entries(links.openers).flatMap(([child, link]) => {
      if (child === key) {
        return [];
      }
      if (link.opener !== key) {
        return [[child, link] as const];
      }
      return opener === undefined || opener === child
        ? []
        : [[child, { ...link, opener }] as const];
    }),
  );
  return { ...links, openers };
}

/** A tab just opened on a side, linked to what it opened from. */
export function withOpened(
  links: TabOpeners,
  {
    isFront,
    opening,
    side,
    source,
    tab,
    up,
  }: {
    isFront: boolean;
    opening: Opening;
    /** The side as it stood before the tab. */
    side: readonly WindowTab[];
    /** The tab it was opened from, where it stands on this side. */
    source: undefined | WindowTab;
    tab: WindowTab;
    /** The tab that was up on this side. */
    up: undefined | WindowTab;
  },
): TabOpeners {
  const key = openerKeyOf(tab);
  // One in front starts a task of its own, as Chromium has it.
  const kept = isFront ? forgetOpeners(links, side) : links;
  const opener = isFront ? up : source;
  const at = source && addressOfTab(source);
  return {
    openers:
      opener === undefined
        ? kept.openers
        : {
            ...kept.openers,
            [key]: {
              opener: openerKeyOf(opener),
              ...(opening.reason === "newTab" ? { once: true } : {}),
            },
          },
    sources:
      opening.reason === "link" && source && at !== undefined
        ? { ...kept.sources, [key]: { at, tab: openerKeyOf(source) } }
        : kept.sources,
  };
}

/** With links of tabs no longer open dropped. */
export function prunedOpeners(
  links: TabOpeners,
  tabs: readonly WindowTab[],
): TabOpeners {
  const open = new Set(tabs.map(openerKeyOf));
  const isOpen = ([key]: [string, unknown]) => open.has(key);
  const openers = Object.entries(links.openers).filter(isOpen);
  const sources = Object.entries(links.sources).filter(isOpen);
  return openers.length === Object.keys(links.openers).length &&
    sources.length === Object.keys(links.sources).length
    ? links
    : {
        openers: Object.fromEntries(openers),
        sources: Object.fromEntries(sources),
      };
}

function withoutOpener(links: TabOpeners, key: string): TabOpeners {
  const { [key]: _gone, ...openers } = links.openers;
  return { ...links, openers };
}

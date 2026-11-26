import { fileHref } from "@/shared/computer-href";
import { isSameLinkGroup } from "@instrument-org/shared";
import { isSameTabIdentity } from "@/shared/tab-identity";
import { type TabsModel } from "@/shared/tabs";
import { fileURLToPath } from "node:url";

/** A window as its strip is matched: what it keeps of its tabs. */
export interface StripOf<W> {
  model: TabsModel;
  window: W;
}

/**
 * Whether a tab's address stands at an address, or shows what it shows
 * (`tabIdentityOf`: a file, a folder, a chat, however far the tab has walked
 * within it).
 */
function standsAt(pathname: string, href: string, homeDir?: string) {
  return (
    pathname === href ||
    pathname.startsWith(`${href}?`) ||
    isSameTabIdentity(pathname, href, homeDir)
  );
}

/**
 * The window whose strip has a tab at an address (`standsAt`): the first
 * with that tab up, else the first with it behind, in the order given.
 */
export function stripShowing<W>(
  href: string,
  strips: readonly StripOf<W>[],
  homeDir?: string,
): W | null {
  let behind: W | null = null;
  for (const { model, window } of strips) {
    const { selectedId, tabs } = model;
    if (
      tabs.some(
        (tab) => tab.id === selectedId && standsAt(tab.pathname, href, homeDir),
      )
    ) {
      return window;
    }
    if (!behind && tabs.some((tab) => standsAt(tab.pathname, href, homeDir))) {
      behind = window;
    }
  }
  return behind;
}

/**
 * As `stripShowing`, among the windows other than the one asking, by its
 * web contents: where else a tab the asking window does not have stands.
 */
export function otherStripShowing<W>(
  href: string,
  strips: readonly (StripOf<W> & { webContentsId: number })[],
  asking: number,
  homeDir?: string,
): W | null {
  return stripShowing(
    href,
    strips.filter((strip) => strip.webContentsId !== asking),
    homeDir,
  );
}

/**
 * Of the windows listing a tab group, in the order given, the first with it
 * up, else the first with it behind: the window a chat's asks go to, so what
 * its agent opens is placed by the window the person sees the group in.
 */
export function windowListingGroup<W>(
  group: string,
  windows: readonly { listed: readonly string[]; up?: string; window: W }[],
): W | null {
  const listing = windows.filter(({ listed }) => listed.includes(group));
  return (listing.find(({ up }) => up === group) ?? listing[0])?.window ?? null;
}

/**
 * Of the windows in the order given, the one listing the tab group a link's
 * group word names (`isSameLinkGroup`): of several such groups, the one that
 * came up last (`shownAt`). Null where no window lists one.
 */
export function windowWithLinkGroup<W>(
  word: string,
  windows: readonly { listed: readonly string[]; window: W }[],
  named: readonly { group: string; linkGroup: string; shownAt?: number }[],
): W | null {
  const [last] = named
    .filter(({ linkGroup }) => isSameLinkGroup(linkGroup, word))
    .flatMap(({ group, shownAt }) => {
      const holder = windows.find(({ listed }) => listed.includes(group));
      return holder ? [{ shownAt: shownAt ?? 0, window: holder.window }] : [];
    })
    .toSorted((a, b) => b.shownAt - a.shownAt);
  return last?.window ?? null;
}

/** A tab kept in a tab group, as main reads it: a screen at `href`, or a page at `url`. */
export interface GroupTabOf {
  group: string;
  href?: string;
  url?: string;
}

/**
 * Of the windows in the order given, the one with a tab in a group it lists
 * showing exactly what an address shows (`tabIdentityOf`: the same file, the
 * same Files folder, the same chat, task, app or Settings, never a folder
 * for a file in it), a file's page counting as the file: the first with
 * that group up, else the first listing it behind.
 */
export function windowWithGroupTabShowing<W>(
  href: string,
  windows: readonly { listed: readonly string[]; up?: string; window: W }[],
  tabs: readonly GroupTabOf[],
  homeDir?: string,
): W | null {
  const groups = new Set(
    tabs.flatMap((tab) => {
      const shown =
        tab.href ??
        (tab.url === undefined ? undefined : fileHrefOfUrl(tab.url));
      return shown !== undefined && isSameTabIdentity(shown, href, homeDir)
        ? [tab.group]
        : [];
    }),
  );
  const listing = windows.filter(({ listed }) =>
    listed.some((group) => groups.has(group)),
  );
  return (
    (listing.find(({ up }) => up !== undefined && groups.has(up)) ?? listing[0])
      ?.window ?? null
  );
}

/** The Files address of the file a page at a `file:` URL shows, if it is one. */
function fileHrefOfUrl(url: string) {
  if (!url.startsWith("file:")) {
    return undefined;
  }
  try {
    return fileHref(fileURLToPath(url));
  } catch {
    return undefined;
  }
}

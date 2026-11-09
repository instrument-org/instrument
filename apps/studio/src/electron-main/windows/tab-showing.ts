import { isSameTabIdentity } from "@/shared/tab-identity";
import { type TabsModel } from "@/shared/tabs";

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

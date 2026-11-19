import { type WindowTab } from "@/client/atoms/window";
import { useGuest } from "@/client/hooks/use-browser-targets";
import { getGuest, goGuest, onPageThumb } from "@/client/lib/browser-pool";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import {
  expandHomePath,
  isPageEditAddress,
  withoutPageEditParam,
} from "@instrument-org/shared";
import {
  browserTargetOf,
  type BrowserTargetId,
} from "@instrument-org/workspace/client";
import { getFileType } from "@/client/lib/get-file-type";
import { useStore } from "jotai";
import { noop } from "radashi";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { useWindow } from "./context";
import { type PageHost, usePageHost } from "./page-hosts";
import { matchScreen } from "./window-href";
import { hostGroupOf, useWindowTabs, windowTabsAtom } from "./window-tabs";

/**
 * What a page drawn in a file tab's viewer moving means for the
 * tab around it:
 *
 * - `back`: the mouse's back button pressed over the page, or the back
 *   chord pressed in it, with nothing of the page's own behind it. The file
 *   is the start of the page's history, so the step is the tab's, back to
 *   where the file was opened from.
 * - `forward`: the same forward, with nothing of the page's own ahead of it:
 *   the tab's step forward.
 * - `file`: the page went to another file on the computer (a link, or a step
 *   through its own history), which the tab shows in the file's place, its
 *   tree following, without a step of the tab's own.
 * - `site`: a link took the page off the computer, and the tab becomes the
 *   page at that address.
 *
 * Anything else (the file itself, reloaded or loaded in Edit) is the tab
 * staying where it is.
 */
export type HostedPageStep =
  | undefined
  | { kind: "back" }
  | { kind: "forward" }
  | { kind: "file"; path: string }
  | { kind: "site"; url: string };

export function hostedPageStep(
  url: string,
  { fileUrl }: { fileUrl: string },
): HostedPageStep {
  if (url === "" || isPageEditAddress(url) || sameDocument(url, fileUrl)) {
    return undefined;
  }
  if (url === "about:blank") {
    return undefined;
  }
  const path = hostPathOfFileUrl(url);
  return path === undefined ? { kind: "site", url } : { kind: "file", path };
}

/**
 * Where a page on a file stands now, as a browser would show it: the file's
 * address with the query and fragment the page has gone to in itself, and
 * without Edit's. Nothing when the guest is gone or on another file (a page
 * kept blank, or still loading the file it was sent to), whose address would
 * not be this file's.
 */
export function liveFileAddress(target: BrowserTargetId, path: string) {
  const url = getGuest(target)?.url();
  return url &&
    hostPathOfFileUrl(url) === expandHomePath(path, window.api.homeDir)
    ? withoutPageEditParam(url)
    : undefined;
}

/** {@link liveFileAddress} for the page a file tab draws in its viewer, by the tab's id. */
export function liveHostedFileAddress(
  tabs: readonly WindowTab[],
  tabId: string,
  path: string,
) {
  const hosted = tabs.find(
    (tab) => tab.group === hostGroupOf(tabId) && tab.kind === "page",
  );
  return hosted && liveFileAddress(browserTargetOf(hosted.id), path);
}

/**
 * Follows the guest of a page drawn inside a file tab and hands each move
 * that takes it off the file to the tab; see `hostedPageStep`. The mouse's
 * thumb buttons over the page walk the page's own history, and a step past
 * either end of it is the tab's. A page going on to a site starts its own history
 * there, since what came before it is the tab's.
 */
export function useHostedPageNavigation(
  target: BrowserTargetId | undefined,
  fileUrl: string | undefined,
  onStep: (step: NonNullable<HostedPageStep>) => void,
) {
  const guest = useGuest(target);
  const latest = useRef({ fileUrl, onStep });
  useEffect(() => {
    latest.current = { fileUrl, onStep };
  });
  useEffect(() => {
    if (target === undefined || !guest) {
      return;
    }
    const onNavigate = () => {
      const { fileUrl: shown, onStep: step } = latest.current;
      if (shown === undefined) {
        return;
      }
      const url = guest.url();
      // A file the host sent the page to is the tab staying where it is,
      // however late it lands: walking a folder sends the next file before
      // the last has arrived. The page's history starts there, as a page
      // opened there would, so back from it is the tab's.
      if (tookHostLoad(target, url)) {
        guest.clearHistory();
        return;
      }
      const next = hostedPageStep(url, { fileUrl: shown });
      if (!next) {
        return;
      }
      // The tab's own history holds the file now, behind the page; the
      // guest's would hold it a second time.
      if (next.kind === "site") {
        guest.clearHistory();
      }
      step(next);
    };
    const stopNavigate = guest.on("did-navigate", onNavigate);
    const releaseThumbs = onPageThumb(target, (direction) => {
      if (!goGuest(target, direction) && latest.current.fileUrl !== undefined) {
        latest.current.onStep({ kind: direction });
      }
    });
    return () => {
      stopNavigate();
      releaseThumbs();
    };
  }, [guest, target]);
}

/**
 * The addresses a host sent each page to, oldest first, until the page's
 * navigation to each lands. Few are ever waiting, but a page whose host never
 * watches it (Quick Look's) keeps only the latest.
 */
const hostLoads = new Map<BrowserTargetId, string[]>();
const HOST_LOADS_KEPT = 8;
/** How long a page put away for a file of another kind is kept for the next page. */
const PARKED_PAGE_MS = 30_000;

/**
 * How many surfaces draw each group's page now. A surface drawn afresh (its
 * tab moved to the other side, its screen's router made again) goes and
 * comes back in one commit, and the one coming finds the page the one going
 * left, so the one going lets the page be.
 */
const hostsOfGroup = new Map<string, number>();

function countHost(group: string, by: 1 | -1) {
  const count = (hostsOfGroup.get(group) ?? 0) + by;
  if (count > 0) {
    hostsOfGroup.set(group, count);
  } else {
    hostsOfGroup.delete(group);
  }
}

function noteHostLoad(target: BrowserTargetId, url: string) {
  const loads = [...(hostLoads.get(target) ?? []), url];
  hostLoads.set(target, loads.slice(-HOST_LOADS_KEPT));
}

/**
 * Whether the page's navigation to `url` is one its host sent it on, taking
 * it and every one sent before it, which the page has gone past.
 */
function tookHostLoad(target: BrowserTargetId, url: string) {
  const loads = hostLoads.get(target) ?? [];
  const at = loads.findIndex((sent) => sameDocument(sent, url));
  if (at === -1) {
    return false;
  }
  hostLoads.set(target, loads.slice(at + 1));
  return true;
}

/**
 * Two addresses of one document: the same but for a fragment, or one file
 * however its path was escaped.
 */
function sameDocument(a: string, b: string) {
  const path = hostPathOfFileUrl(a);
  if (path !== undefined) {
    return path === hostPathOfFileUrl(b);
  }
  return a.replace(/#.*$/, "") === b.replace(/#.*$/, "");
}

/**
 * A page drawn inside a surface rather than as a tab of its own (a file's
 * page in its viewer, the page under Quick Look): a page tab in the
 * surface's own group at `url`, the one tab that group keeps, drawn into the
 * element handed to `setSlot`, and closed a while after `url` goes
 * (`PARKED_PAGE_MS`) or when the surface does. A tab handed to `release` outlives the surface, for a page that has
 * gone on to be a tab of the window's.
 *
 * While the window's browser has not arrived (a window opening on a file),
 * the group is left as it is, so a page kept from the last launch is taken
 * up rather than closed and opened again.
 */
export function useHostedPage({
  group,
  host,
  keepsPage,
  url,
}: {
  group: string;
  host: Omit<PageHost, "into">;
  /** Whether the page outlives the surface, asked as the surface goes; without it the page closes then. */
  keepsPage?: () => boolean;
  url: string | undefined;
}) {
  const { browser } = useWindow();
  const { allTabs, close } = useWindowTabs();
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const hasBrowser = browser !== null;
  const tabIds = allTabs
    .filter((tab) => tab.group === group)
    .map((tab) => tab.id);
  const tabIdsKey = tabIds.join("\n");
  // The tabs as they stand now, for the way out: the cleanup below runs once,
  // long after the render that set it up.
  const tabIdsNow = useRef(tabIds);
  useEffect(() => {
    tabIdsNow.current = tabIdsKey.split("\n").filter(Boolean);
  }, [tabIdsKey]);
  // One page at a time: the one opened replaces any before it. A page
  // already up goes on to the next address in its own guest, rather than a
  // guest being made for each file a folder is walked through.
  const parked = useRef<number | undefined>(undefined);
  const showPage = useEffectEvent(() => {
    if (url !== undefined && !browser) {
      return;
    }
    window.clearTimeout(parked.current);
    parked.current = undefined;
    const current = allTabs.find(
      (tab) =>
        tab.group === group &&
        tab.kind === "page" &&
        tabIdsNow.current.includes(tab.id),
    );
    let kept: string | undefined;
    if (url !== undefined && browser) {
      if (current?.kind !== "page") {
        kept = browser.openOrFocus(url, { group });
      } else {
        // A page kept from the last launch at this address is taken up as
        // it is. The guest's own address goes first, since one kept while
        // a file of another kind was shown is blank.
        const shown =
          getGuest(browserTargetOf(current.id))?.url() || current.url;
        if (shown === undefined || !sameDocument(shown, url)) {
          noteHostLoad(browserTargetOf(current.id), url);
          browser.navigateTab(current.id, url);
        }
        kept = current.id;
      }
    } else if (url === undefined && current) {
      // A page put away for a file of another kind keeps its guest a while,
      // blank so nothing of it plays on out of sight, for the next page in a
      // folder being walked to go on in. Its history goes with what it
      // showed: back would otherwise walk the hidden guest onto the file it
      // left for, a video playing again where no one can see or stop it.
      const { id } = current;
      kept = id;
      const guest = getGuest(browserTargetOf(id));
      guest
        ?.load("about:blank")
        .then(() => {
          guest.clearHistory();
        })
        .catch(noop);
      parked.current = window.setTimeout(() => {
        parked.current = undefined;
        hostLoads.delete(browserTargetOf(id));
        close(id);
      }, PARKED_PAGE_MS);
    }
    for (const id of tabIdsNow.current) {
      if (id !== kept) {
        hostLoads.delete(browserTargetOf(id));
        close(id);
      }
    }
  });
  // Once per page and group; the browser handle is stable once it exists.
  useEffect(() => {
    showPage();
  }, [url, group, hasBrowser]);
  const closeAll = useEffectEvent(() => {
    // A page still on its file stays live in its guest when the surface
    // says so, for the surface coming back, or an agent, to take up; one put
    // away blank closes as it would have.
    if (parked.current === undefined && keepsPage?.() === true) {
      return;
    }
    window.clearTimeout(parked.current);
    for (const id of tabIdsNow.current) {
      hostLoads.delete(browserTargetOf(id));
      close(id);
    }
  });
  // On the way out alone, once the commit taking this surface away is
  // done: a surface for the same group mounted in it takes the page up.
  useEffect(() => {
    countHost(group, 1);
    return () => {
      countHost(group, -1);
      queueMicrotask(() => {
        if (hostsOfGroup.has(group)) {
          window.clearTimeout(parked.current);
        } else {
          closeAll();
        }
      });
    };
  }, [group]);
  // A page put away stops being drawn at once. Its slot can outlive it, inside
  // a viewer fading out, and the guest stands apart from that fade: at full
  // strength, blank, over whatever the viewer is giving way to.
  usePageHost(group, { ...host, into: url === undefined ? null : slot });
  return {
    release: (tabId: string) => {
      tabIdsNow.current = tabIdsNow.current.filter((id) => id !== tabId);
    },
    setSlot,
    /** The page's tab, once the group has one. */
    tabId: url === undefined ? undefined : tabIds[0],
  };
}

/**
 * The HTML file a tab draws as its page: a Files tab standing on a page's
 * file, not asked for its source. Nothing for any other tab.
 */
export function pageFileOfTab(tab: WindowTab | undefined) {
  if (tab?.kind !== "screen") {
    return undefined;
  }
  const screen = matchScreen(tab.href);
  if (
    screen.kind !== "computer" ||
    screen.file === undefined ||
    new URLSearchParams(tab.href.split("?")[1]).has("source")
  ) {
    return undefined;
  }
  return getFileType({ filename: screen.file }) === "html"
    ? screen.file
    : undefined;
}

/**
 * Whether the page a group's file tab draws in its viewer outlives the
 * viewer going: while the tab still stands on a page's file. A group draws
 * only the tab up, so the viewer goes whenever another tab comes up; the
 * guest stays live in the pool under its page tab, for the viewer coming back
 * and for an agent driving the file's page, which is the tab's own.
 */
export function keepsHostedPage(tabs: readonly WindowTab[], tabId: string) {
  const tab = tabs.find((each) => each.id === tabId);
  return tab?.group !== undefined && pageFileOfTab(tab) !== undefined;
}

/** The tab a hosted page's group was made for, for a group named by `hostGroupOf`. */
function ownerOfHostGroup(group: string | undefined) {
  const prefix = hostGroupOf("");
  return group?.startsWith(prefix) ? group.slice(prefix.length) : undefined;
}

/**
 * The pages kept live for file tabs ({@link keepsHostedPage}) whose tab has
 * since closed or gone on from a page's file. A tab counts as closed only
 * once it was `seen`, so a page whose tab the window has not read yet is
 * left alone.
 */
export function strandedHostedPages(
  tabs: readonly WindowTab[],
  seen: ReadonlySet<string>,
) {
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  return tabs.flatMap((page) => {
    const owner = ownerOfHostGroup(page.group);
    if (owner === undefined || !seen.has(owner)) {
      return [];
    }
    return pageFileOfTab(byId.get(owner)) === undefined ? [page.id] : [];
  });
}

/** Closes the window's {@link strandedHostedPages} as they come about. */
export function useCloseStrandedHostedPages() {
  const { allTabs, close } = useWindowTabs();
  const seen = useRef(new Set<string>());
  const closeStranded = useEffectEvent((tabs: readonly WindowTab[]) => {
    for (const tab of tabs) {
      if (ownerOfHostGroup(tab.group) === undefined) {
        seen.current.add(tab.id);
      }
    }
    for (const id of strandedHostedPages(tabs, seen.current)) {
      hostLoads.delete(browserTargetOf(id));
      close(id);
    }
  });
  useEffect(() => {
    closeStranded(allTabs);
  }, [allTabs]);
}

/** {@link keepsHostedPage} for a file tab's viewer, read from the window's tabs as the viewer goes. */
export function useKeepsHostedPage(tabId: string) {
  const store = useStore();
  return () => keepsHostedPage(store.get(windowTabsAtom).tabs, tabId);
}

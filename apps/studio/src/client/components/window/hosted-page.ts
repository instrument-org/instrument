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
import { noop } from "radashi";
import { useEffect, useRef, useState } from "react";

import { useWindow } from "./context";
import { type PageHost, usePageHost } from "./page-hosts";
import { useWindowTabs } from "./window-tabs";

/**
 * What a page drawn inside a file tab (beside its tree) moving means for the
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

/** {@link liveFileAddress} for the page a file tab draws beside its tree, by the tab's id. */
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
 * The group of the page a file tab draws beside its tree, by the tab's id: a
 * group no strip lists, holding that one page.
 */
export function hostGroupOf(tabId: string) {
  return `page:${tabId}`;
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
  url,
}: {
  group: string;
  host: Omit<PageHost, "into">;
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
  useEffect(() => {
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
      // folder being walked to go on in.
      const { id } = current;
      kept = id;
      getGuest(browserTargetOf(id))?.load("about:blank").catch(noop);
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
    // Once per page and group; the browser handle is stable once it exists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, group, hasBrowser]);
  useEffect(
    () => () => {
      window.clearTimeout(parked.current);
      for (const id of tabIdsNow.current) {
        hostLoads.delete(browserTargetOf(id));
        close(id);
      }
    },
    // On the way out alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  usePageHost(group, { ...host, into: slot });
  return {
    release: (tabId: string) => {
      tabIdsNow.current = tabIdsNow.current.filter((id) => id !== tabId);
    },
    setSlot,
    /** The page's tab, once the group has one. */
    tabId: url === undefined ? undefined : tabIds[0],
  };
}

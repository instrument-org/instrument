import { useGuest } from "@/client/hooks/use-browser-targets";
import { goGuest, onPageThumb } from "@/client/lib/browser-pool";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { isPageEditAddress } from "@instrument-org/shared";
import { type BrowserTargetId } from "@instrument-org/workspace/client";
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
      const next = hostedPageStep(guest.url(), { fileUrl: shown });
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
 * element handed to `setSlot`, and closed when `url` goes or the surface
 * does. A tab handed to `release` outlives the surface, for a page that has
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
  // One page at a time: the one opened replaces any before it.
  useEffect(() => {
    if (url !== undefined && !browser) {
      return;
    }
    const kept =
      url === undefined || !browser
        ? undefined
        : browser.openOrFocus(url, { group });
    for (const id of tabIdsNow.current) {
      if (id !== kept) {
        close(id);
      }
    }
    // Once per page and group; the browser handle is stable once it exists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, group, hasBrowser]);
  useEffect(
    () => () => {
      for (const id of tabIdsNow.current) {
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

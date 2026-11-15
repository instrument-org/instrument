import { pageRequestAtom } from "@/client/atoms/page-requests";
import { settingsHrefOf } from "@/client/components/settings/settings-href";
import { SCREENS, screenOfHref } from "@/shared/instrument-screens";
import { useAtomValue, useSetAtom } from "jotai";
import { useContext, useEffect, useEffectEvent } from "react";

import { WindowContext } from "./context";
import { showsSame } from "./window-href";
import { useWindowTabs } from "./window-tabs";

type WindowTabsHandle = ReturnType<typeof useWindowTabs>;

/**
 * Brings up the tab of the group on screen already showing what an address
 * shows, the tab up first, and walks it there when the address asks for a
 * part of a built-in page it is not at (a part of Settings, a row to light);
 * false when no tab there shows it. Every other screen comes forward as it
 * stands, as `selectShowing` brings it.
 */
export function bringForwardShowing(
  windowTabs: WindowTabsHandle,
  href: string,
): boolean {
  if (!windowTabs.selectShowing(href)) {
    return false;
  }
  const shows = (tab: WindowTabsHandle["tabs"][number]) =>
    tab.kind === "screen" && showsSame(tab.href, href);
  const up = windowTabs.active;
  const found = up && shows(up) ? up : windowTabs.tabs.find(shows);
  if (
    found?.kind === "screen" &&
    screenOfHref(href) !== undefined &&
    asksPartOf(href, found.href)
  ) {
    windowTabs.visitHref(found.id, href);
  }
  return true;
}

/**
 * Whether an address of a built-in page asks for more than a tab of it
 * shows: a part the tab is not at (`/settings/providers` of a tab at
 * `/settings/general`), or anything in its search the tab's address does
 * not have as asked. The page's bare address (`/settings`) asks for nothing.
 */
function asksPartOf(asked: string, shown: string): boolean {
  const want = new URL(asked, "http://tabs");
  const have = new URL(shown, "http://tabs");
  const path = (url: URL) => url.pathname.replace(/\/$/, "");
  if (
    path(want) !== path(have) &&
    path(want).split("/").filter(Boolean).length > 1
  ) {
    return true;
  }
  return [...want.searchParams].some(
    ([key, value]) => have.searchParams.get(key) !== value,
  );
}

/**
 * Opens the built-in pages asked for from anywhere in the window
 * (`openBuiltInPage`, `openSettings`): the tab of the group up already
 * showing the page comes forward, at the part asked for, and otherwise the
 * page opens as a new tab right after the tab up, as a browser opens its
 * settings, or in place of a blank New Tab up (`besideUpOf`). Settings with no part named opens at General.
 */
export function BuiltInPageOpener() {
  const request = useAtomValue(pageRequestAtom);
  const setRequest = useSetAtom(pageRequestAtom);
  const appWindow = useContext(WindowContext);
  const windowTabs = useWindowTabs();
  const open = useEffectEvent((href: string) => {
    if (!appWindow || bringForwardShowing(windowTabs, href)) {
      return;
    }
    appWindow.openScreen(href === "/settings" ? SCREENS.settings.href : href, {
      besideUp: true,
    });
  });
  useEffect(() => {
    if (request === null) {
      return;
    }
    setRequest(null);
    open("href" in request ? request.href : settingsHrefOf(request.settings));
  }, [request, setRequest]);
  return null;
}

import { pageRequestAtom } from "@/client/atoms/page-requests";
import { settingsHrefOf } from "@/client/components/settings/settings-href";
import { SCREENS, screenOfHref } from "@/shared/instrument-screens";
import { useAtomValue, useSetAtom } from "jotai";
import { useContext, useEffect, useEffectEvent } from "react";

import { chatsAskOf, showChatsInPanel } from "./chats-ask";
import { WindowContext } from "./context";
import { asksPartOf, matchScreen, showsSame } from "./window-href";
import { useWindowTabs } from "./window-tabs";

type WindowTabsHandle = ReturnType<typeof useWindowTabs>;

/**
 * Brings up the tab of the group on screen already showing what an address
 * shows, the tab up first, and walks it there when the address asks for a
 * part of a built-in page it is not at (a part of Settings, a row to light,
 * one debug page of another);
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
    (screenOfHref(href) !== undefined || matchScreen(href).kind === "debug") &&
    asksPartOf(href, found.href)
  ) {
    windowTabs.visitHref(found.id, href);
  }
  return true;
}

/** The window's way to open a built-in page as a group of its own (`setBuiltInPageGroupOpener`). */
let openAsGroup: ((href: string) => void) | undefined;

/**
 * Sets how this window opens a built-in page no tab of the group up shows:
 * as a group of its own, or a group that is only a tab showing it. Answers with the
 * way to take it back.
 */
export function setBuiltInPageGroupOpener(open: (href: string) => void) {
  openAsGroup = open;
  return () => {
    if (openAsGroup === open) {
      openAsGroup = undefined;
    }
  };
}

/**
 * Opens the built-in pages asked for from anywhere in the window
 * (`openBuiltInPage`, `openSettings`): the tab of the group up already
 * showing the page comes forward, at the part asked for, and otherwise the
 * page comes up as a tab group of its own, as ⌘N makes one, or in a group
 * that is only a tab showing it (`setBuiltInPageGroupOpener`). Settings with no part
 * named opens at General.
 */
export function BuiltInPageOpener() {
  const request = useAtomValue(pageRequestAtom);
  const setRequest = useSetAtom(pageRequestAtom);
  const appWindow = useContext(WindowContext);
  const windowTabs = useWindowTabs();
  const open = useEffectEvent((href: string) => {
    const chats = chatsAskOf(href);
    if (chats) {
      showChatsInPanel(chats);
      return;
    }
    if (!appWindow || bringForwardShowing(windowTabs, href)) {
      return;
    }
    if (openAsGroup) {
      openAsGroup(href);
    } else {
      appWindow.openScreen(
        href === "/settings" ? SCREENS.settings.href : href,
        { newTab: "reuseBlank" },
      );
    }
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

import { paneOpenByGroupAtom, type WindowTab } from "@/client/atoms/window";
import { useRouterState } from "@tanstack/react-router";
import { useAtomValue } from "jotai";

import { appTabsAtom } from "./app-tabs";
import { isGroupShown, tabInView } from "./draft-context";
import { useWindowTabs } from "./window-tabs";

/**
 * What the window has in view behind its floating windows: see tabInView.
 * Nothing before the window has a tab up.
 */
export function useTabInView(): undefined | WindowTab {
  const windowTabs = useWindowTabs();
  const appTabs = useAtomValue(appTabsAtom);
  const activeHref = useRouterState({
    select: (routerState) => routerState.location.href,
  });
  const paneOpenByGroup = useAtomValue(paneOpenByGroupAtom);
  return appTabs.selectedId === null
    ? undefined
    : tabInView({
        activeHref,
        appTabId: appTabs.selectedId,
        groupTab: windowTabs.active,
        isGroupTabShown: isGroupShown(
          windowTabs.groupOnScreen,
          paneOpenByGroup,
        ),
      });
}

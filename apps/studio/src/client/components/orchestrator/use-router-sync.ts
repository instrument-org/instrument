import { useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";

import { PAGE_ROUTE, type useWindowTabs } from "./window-tabs";

/**
 * Keeps the router and the tab on screen agreeing: the address follows the
 * tab, and a screen navigating inside itself, or a walk back and forward
 * through the history, changes the tab it happened in rather than opening
 * another.
 */
export function useRouterSync(windowTabs: ReturnType<typeof useWindowTabs>) {
  const router = useRouter();
  const location = useRouterState({
    select: (routerState) => routerState.location,
  });
  const { active } = windowTabs;
  // The router follows the tab on screen: a screen's own address, or the
  // page route, which shows nothing of its own, while a page is up or no tab
  // is. Checked against the history's own address rather than the rendered
  // one: two pushes in one tick reach the render one at a time, and a push
  // made against the earlier of them would be a step backward.
  useEffect(() => {
    const latest = router.history.location;
    if (!active || active.kind === "page") {
      if (latest.pathname !== PAGE_ROUTE) {
        router.history.push(PAGE_ROUTE);
      }
    } else if (latest.href !== active.href) {
      router.history.push(active.href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  // Route navigation stays in this tab, including when leaving a website.
  useEffect(() => {
    if (windowTabs.group === undefined) {
      return;
    }
    // An address the history has already moved past is not one to follow:
    // the tabs were set for where the history is now, and following the
    // stale one would move them back, and the effect above forward, without
    // end.
    if (router.history.location.href !== location.href) {
      return;
    }
    if (location.pathname === PAGE_ROUTE) {
      // History walked back to the page route while a screen is up (a page
      // was on screen at that point in the history); the screen stays, and
      // the address goes back to it.
      if (active?.kind === "screen") {
        router.history.replace(active.href);
      }
      return;
    }
    if (!active) {
      // Nothing under the head to move: a screen the router was sent to
      // opens as the group's first tab.
      windowTabs.openScreen(location.href);
    } else if (active.kind === "screen") {
      windowTabs.setActiveHref(location.href);
    } else {
      windowTabs.navigateScreen(location.href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.href]);
}

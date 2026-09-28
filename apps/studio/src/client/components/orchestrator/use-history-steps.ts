import { useRouter } from "@tanstack/react-router";

import { type BrowserTabsHandle } from "./browser-tabs";
import { type useWindowTabs } from "./window-tabs";

/**
 * Back and forward for what is on screen, and whether either has anywhere
 * to go: the guest's own history, the tab's trail of screens, and the
 * visits across the two, in that order.
 */
export function useHistorySteps({
  browser,
  windowTabs,
}: {
  /** The window's browser, whose guest keeps the page's own history; null until it is mounted. */
  browser: BrowserTabsHandle | null;
  windowTabs: ReturnType<typeof useWindowTabs>;
}) {
  const router = useRouter();
  const { active } = windowTabs;
  const isPageOnScreen = active?.kind === "page";
  // Walk the current screen or guest first, then cross into the preceding or
  // following visit in this tab. Guests stay alive while a screen is up.
  const canGoBack =
    Boolean(active?.past?.length) ||
    (isPageOnScreen ? true : windowTabs.canStepBack);
  const canGoForward = isPageOnScreen
    ? Boolean(active.future?.length) || (browser?.canGoForward ?? false)
    : Boolean(active?.future?.length) || windowTabs.canStepForward;
  const goBack = () => {
    if (!active) {
      return;
    }
    if (active.kind === "page") {
      if (browser?.canGoBack) {
        browser.goBack();
      } else {
        windowTabs.stepVisit(-1);
      }
      return;
    }
    const href = windowTabs.step(-1);
    if (href !== undefined) {
      router.history.push(href);
    } else if (windowTabs.stepVisit(-1)) {
      return;
    } else if (active.isOpened) {
      // Nothing behind it, and something else opened it: back is the way out
      // of a tab that exists to show one thing.
      windowTabs.close(active.id);
    }
  };
  const goForward = () => {
    if (active?.kind === "page") {
      if (active.future?.length && !active.pageBackSteps) {
        windowTabs.stepVisit(1);
      } else {
        browser?.goForward();
      }
      return;
    }
    const href = windowTabs.step(1);
    if (href === undefined) {
      windowTabs.stepVisit(1);
    } else {
      router.history.push(href);
    }
  };
  return { canGoBack, canGoForward, goBack, goForward };
}

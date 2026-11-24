import { useContext } from "react";

import { WindowContext } from "./context";
import { matchScreen } from "./window-href";
import { useWindowTabs } from "./window-tabs";

/**
 * Brings up an app's own page: the tab its group has at it already, else a
 * new tab, so what is up stays as it is.
 */
export function useShowAppPage() {
  const appWindow = useContext(WindowContext);
  const windowTabs = useWindowTabs();
  return (slug: string, from: { group?: string; tab?: string } = {}) => {
    const group = from.group ?? windowTabs.groupOnScreen;
    const page = windowTabs.allTabs.find((tab) => {
      if (tab.kind !== "screen" || tab.group !== group) {
        return false;
      }
      const screen = matchScreen(tab.href);
      return screen.kind === "app" && screen.slug === slug;
    });
    if (page === undefined || !appWindow?.showTab?.(page.id)) {
      appWindow?.openScreen(`/apps/${slug}`, {
        newTab: true,
        ...(from.tab === undefined ? {} : { from: from.tab }),
      });
    }
  };
}

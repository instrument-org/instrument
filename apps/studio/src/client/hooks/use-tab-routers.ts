import { createTabRouter } from "@/client/lib/tab-router";
import {
  getTabRouter,
  getTabRouters,
  pruneTabRouters,
  setTabRouter,
} from "@/client/lib/tab-router-registry";
import { type Tab } from "@/shared/tabs";
import { useEffect } from "react";

/**
 * Backs each open tab with a router from the shared registry: created lazily on
 * first appearance (synchronously, so the window can hand the active tab's
 * router to the chrome on first paint) and pruned when the tab closes. The
 * registry is the single owner, so the chrome and the app-command bus read the
 * same routers via `getTabRouter`.
 */
export function useTabRouters(tabs: Tab[]) {
  for (const tab of tabs) {
    if (!getTabRouter(tab.id)) {
      setTabRouter(
        tab.id,
        createTabRouter({ history: tab.history, pathname: tab.pathname }),
      );
    }
  }

  // `tabs` changes reference only when the tab set changes (add/remove/reorder),
  // so this prunes exactly then -- including speculative routers left by an
  // abandoned transition render, since effects run only on commit.
  useEffect(() => {
    pruneTabRouters(new Set(tabs.map((tab) => tab.id)));
  }, [tabs]);

  return getTabRouters();
}

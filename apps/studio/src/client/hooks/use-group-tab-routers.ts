import { type WindowTab } from "@/client/atoms/window";
import { sameHref } from "@/client/components/window/window-href";
import {
  deleteGroupTabRouter,
  getGroupTabRouter,
  groupTabRouterIds,
  setGroupTabRouter,
} from "@/client/lib/group-tab-router-registry";
import { createTabRouter } from "@/client/lib/tab-router";
import { getRouterHistory } from "@/client/lib/tab-router-history";
import { type TabHistory } from "@/shared/tabs";
import { useEffect } from "react";

/** What each router stopped listening with, by tab id. */
const unsubscribes = new Map<string, () => void>();

/**
 * Backs every screen tab of the window's groups with a router of its own,
 * made from where the tab stands and the history it keeps, and tells the tab
 * each time its router moves, so the tab comes back after a launch where it
 * stood. A tab moved some other way (sent to another address, replaced in
 * place) gets a router made afresh at its new place. Made during render, as
 * the window's own tabs' routers are, so a tab is drawn with its router the
 * first time; a closed tab's router is let go once the change commits.
 */
export function useGroupTabRouters(
  tabs: WindowTab[],
  onMoved: (id: string, moved: { history: TabHistory; href: string }) => void,
) {
  for (const tab of tabs) {
    if (tab.kind !== "screen") {
      continue;
    }
    const existing = getGroupTabRouter(tab.id);
    if (existing && sameHref(existing.history.location.href, tab.href)) {
      continue;
    }
    unsubscribes.get(tab.id)?.();
    const router = createTabRouter({
      ...(tab.history ? { history: tab.history } : {}),
      pathname: tab.href,
    });
    const { id } = tab;
    unsubscribes.set(
      id,
      router.history.subscribe(() => {
        onMoved(id, {
          history: getRouterHistory(router),
          href: router.history.location.href,
        });
      }),
    );
    setGroupTabRouter(id, router);
  }
  const live = tabs
    .flatMap((tab) => (tab.kind === "screen" ? [tab.id] : []))
    .join("\n");
  useEffect(() => {
    const kept = new Set(live.split("\n"));
    for (const id of groupTabRouterIds()) {
      if (!kept.has(id)) {
        unsubscribes.get(id)?.();
        unsubscribes.delete(id);
        deleteGroupTabRouter(id);
      }
    }
  }, [live]);
}

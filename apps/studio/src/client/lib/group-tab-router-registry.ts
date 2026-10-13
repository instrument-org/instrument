import { type TabRouter } from "@/client/lib/tab-router";
import { useSyncExternalStore } from "react";

/**
 * The routers of the screen tabs in the window's groups (a chat's pane, a
 * draft's band, a site's tab), by tab id: each screen a group's tab shows is
 * a route of the same tree the window's own tabs use, walked by a router of
 * its own. The app window makes them (`useGroupTabRouters`) and drops a
 * tab's with the tab; whatever steps a tab reads it here, and whatever draws
 * one reads it through {@link useGroupTabRouter}.
 *
 * Kept a leaf, as `tab-router-registry.ts` is: `TabRouter` is a type-only
 * import, so this pulls in no route tree.
 */
const routers = new Map<string, TabRouter>();
const listeners = new Set<() => void>();
let isNotifyQueued = false;

/**
 * Told after the current render: routers are set while the app window
 * renders, and a store update to another component mid-render is an error.
 */
function notify() {
  if (isNotifyQueued) {
    return;
  }
  isNotifyQueued = true;
  queueMicrotask(() => {
    isNotifyQueued = false;
    for (const listener of listeners) {
      listener();
    }
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getGroupTabRouter(id: string): TabRouter | undefined {
  return routers.get(id);
}

/**
 * A tab's router for drawing it. A tab sent to another address keeps its id
 * and gets a new router, so a read memoized by the id alone (as the React
 * Compiler memoizes a plain call) would keep drawing the old one.
 */
export function useGroupTabRouter(id: string): TabRouter | undefined {
  return useSyncExternalStore(subscribe, () => routers.get(id));
}

export function setGroupTabRouter(id: string, router: TabRouter) {
  routers.set(id, router);
  notify();
}

/** Every tab id that has a router, for pruning the ones whose tab is gone. */
export function groupTabRouterIds(): string[] {
  return [...routers.keys()];
}

export function deleteGroupTabRouter(id: string) {
  routers.delete(id);
  notify();
}

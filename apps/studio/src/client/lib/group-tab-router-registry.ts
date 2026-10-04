import { type TabRouter } from "@/client/lib/tab-router";

/**
 * The routers of the screen tabs in the window's groups (a chat's pane, a
 * draft's band, a site's tab), by tab id: each screen a group's tab shows is
 * a route of the same tree the window's own tabs use, walked by a router of
 * its own. The app window makes them (`useGroupTabRouters`) and drops a
 * tab's with the tab; whatever draws or steps a tab reads it here.
 *
 * Kept a leaf, as `tab-router-registry.ts` is: `TabRouter` is a type-only
 * import, so this pulls in no route tree.
 */
const routers = new Map<string, TabRouter>();

export function getGroupTabRouter(id: string): TabRouter | undefined {
  return routers.get(id);
}

export function setGroupTabRouter(id: string, router: TabRouter) {
  routers.set(id, router);
}

/** Every tab id that has a router, for pruning the ones whose tab is gone. */
export function groupTabRouterIds(): string[] {
  return [...routers.keys()];
}

export function deleteGroupTabRouter(id: string) {
  routers.delete(id);
}

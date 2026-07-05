import { type TabRouter } from "@/client/lib/tab-router";
import { type TabId } from "@/shared/tabs";

/**
 * The single source of per-tab routers, keyed by tab id. MainWindow creates a
 * tab's router on first appearance and stores it here (and prunes closed tabs);
 * the unified chrome (which lives outside any per-tab `RouterProvider`) and the
 * app-command bus read routers back out to drive the active tab's navigation.
 *
 * Kept a leaf: `TabRouter` is a type-only import so this doesn't pull in
 * tab-router's routeTree/error-component chain, which loops back here through
 * use-tab-actions (see the import cycle broken in git history).
 */
const registry = new Map<TabId, TabRouter>();

export function getTabRouter(id: null | TabId) {
  return id ? registry.get(id) : undefined;
}

/** The live router map, for MainWindow to render each open tab. */
export function getTabRouters(): ReadonlyMap<TabId, TabRouter> {
  return registry;
}

/** Drop routers whose tab is no longer open (also clears speculative routers
 * created during an abandoned transition render). */
export function pruneTabRouters(liveIds: ReadonlySet<TabId>) {
  for (const id of registry.keys()) {
    if (!liveIds.has(id)) {
      registry.delete(id);
    }
  }
}

export function setTabRouter(id: TabId, router: TabRouter) {
  registry.set(id, router);
}

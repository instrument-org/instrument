import { type TabRouter } from "@/client/lib/tab-router";
import { type TabId } from "@/shared/tabs";

/**
 * Maps tab id -> its router instance. Lets the unified chrome (which lives
 * outside any per-tab `RouterProvider`) drive the active tab's navigation, e.g.
 * back/forward in the toolbar. Populated by each `TabView` on mount.
 */
const registry = new Map<TabId, TabRouter>();

export function getTabRouter(id: null | TabId) {
  return id ? registry.get(id) : undefined;
}

export function registerTabRouter(id: TabId, router: TabRouter) {
  registry.set(id, router);
}

export function unregisterTabRouter(id: TabId) {
  registry.delete(id);
}

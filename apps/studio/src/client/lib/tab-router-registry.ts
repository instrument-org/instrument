import { type TabRouter } from "@/client/lib/tab-router";

/**
 * Maps tab id -> its router instance. Lets the unified chrome (which lives
 * outside any per-tab `RouterProvider`) drive the active tab's navigation, e.g.
 * back/forward in the toolbar. Populated by each `TabView` on mount.
 */
const registry = new Map<string, TabRouter>();

export function getTabRouter(id: null | string) {
  return id ? registry.get(id) : undefined;
}

export function registerTabRouter(id: string, router: TabRouter) {
  registry.set(id, router);
}

export function unregisterTabRouter(id: string) {
  registry.delete(id);
}

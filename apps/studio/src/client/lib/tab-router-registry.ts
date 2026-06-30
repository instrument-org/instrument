import { getRouterHistory, type TabRouter } from "@/client/lib/tab-router";
import { type TabHistory } from "@/shared/tabs";

/**
 * Maps tab id -> its router instance. Lets the unified chrome (which lives
 * outside any per-tab `RouterProvider`) drive the active tab's navigation, e.g.
 * back/forward in the toolbar. Populated by each `TabView` on mount.
 */
const registry = new Map<string, TabRouter>();

/** Live history stack of a tab, captured on close so reopen can restore it. */
export function getTabHistory(id: string): TabHistory | undefined {
  const router = registry.get(id);
  return router ? getRouterHistory(router) : undefined;
}

export function getTabRouter(id: null | string) {
  return id ? registry.get(id) : undefined;
}

export function registerTabRouter(id: string, router: TabRouter) {
  registry.set(id, router);
}

export function unregisterTabRouter(id: string) {
  registry.delete(id);
}

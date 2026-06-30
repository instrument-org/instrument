import { DefaultErrorComponent } from "@/client/components/default-error-component";
import { NotFoundRouteComponent } from "@/client/components/not-found";
import { type TabHistory } from "@/shared/tabs";
import { QueryClient } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter as createTanStackRouter,
} from "@tanstack/react-router";

import { routeTree } from "../routeTree.gen";

/**
 * One QueryClient shared by every per-tab router in the main window so tabs
 * share the local RPC cache. Each tab still gets its own router (own memory
 * history, own route state) so switching tabs preserves scroll/selection and
 * gives each tab independent back/forward, like browser tabs.
 */
export const sharedQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 99% of queries are local RPC and won't change on retry; fail fast.
      retry: 0,
    },
  },
});

export type TabRouter = ReturnType<typeof createTabRouter>;

// createMemoryHistory mutates the `initialEntries` array it's given in place
// (push/splice on navigation), so we keep a reference per router and read it
// back for the live history stack -- no navigation subscription needed.
const routerEntries = new WeakMap<object, string[]>();

export function createTabRouter({
  history,
  pathname,
}: {
  history?: TabHistory;
  pathname: string;
}) {
  const entries = history ? [...history.entries] : [pathname];
  const router = createTanStackRouter({
    context: { queryClient: sharedQueryClient },
    defaultErrorComponent: DefaultErrorComponent,
    defaultNotFoundComponent: NotFoundRouteComponent,
    defaultPreload: false,
    history: createMemoryHistory({
      initialEntries: entries,
      initialIndex: history?.index,
    }),
    routeTree,
    scrollRestoration: true,
  });
  routerEntries.set(router, entries);
  return router;
}

/** Snapshot a tab router's current back/forward stack, for restoring on reopen. */
export function getRouterHistory(router: TabRouter): TabHistory {
  return {
    entries: [...(routerEntries.get(router) ?? [])],
    index: router.history.location.state.__TSR_index,
  };
}

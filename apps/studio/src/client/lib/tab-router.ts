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
  // Only restore a non-empty stack: createMemoryHistory throws on an empty
  // initialEntries / out-of-range index, and once that bad value is persisted it
  // bricks every boot. Fall back to the tab's pathname otherwise.
  const restored = history && history.entries.length > 0 ? history : undefined;
  const entries = restored ? [...restored.entries] : [pathname];
  const router = createTanStackRouter({
    context: { queryClient: sharedQueryClient },
    defaultErrorComponent: DefaultErrorComponent,
    defaultNotFoundComponent: NotFoundRouteComponent,
    defaultPreload: false,
    history: createMemoryHistory({
      initialEntries: entries,
      initialIndex: restored
        ? Math.min(Math.max(restored.index, 0), entries.length - 1)
        : undefined,
    }),
    routeTree,
    scrollRestoration: true,
  });
  routerEntries.set(router, entries);
  return router;
}

/** Snapshot a tab router's current back/forward stack, for restoring on reopen. */
export function getRouterHistory(router: TabRouter): TabHistory {
  const entries = routerEntries.get(router);
  // Fall back to the current location if the reference was lost (e.g. an HMR
  // module swap) so the snapshot is always a valid, non-empty stack.
  if (!entries || entries.length === 0) {
    return { entries: [router.history.location.href], index: 0 };
  }
  return {
    entries: [...entries],
    index: router.history.location.state.__TSR_index,
  };
}

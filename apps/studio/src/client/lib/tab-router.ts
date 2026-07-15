import { DefaultErrorComponent } from "@/client/components/default-error-component";
import { NotFoundRouteComponent } from "@/client/components/not-found";
import { type TabHistory } from "@/shared/tabs";
import { QueryClient } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter as createTanStackRouter,
} from "@tanstack/react-router";

import { routeTree } from "../routeTree.gen";
import { shouldRestoreScroll } from "./scroll-restoration";
import { routerEntries } from "./tab-router-history";
import { captureException } from "./telemetry";

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
    defaultOnCatch: (error, errorInfo) => {
      captureException(error, { componentStack: errorInfo.componentStack });
    },
    defaultPreload: false,
    history: createMemoryHistory({
      initialEntries: entries,
      initialIndex: restored
        ? Math.min(Math.max(restored.index, 0), entries.length - 1)
        : undefined,
    }),
    routeTree,
    scrollRestoration: shouldRestoreScroll,
  });
  routerEntries.set(router, entries);
  return router;
}

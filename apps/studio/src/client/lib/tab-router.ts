import { DefaultErrorComponent } from "@/client/components/default-error-component";
import { NotFoundRouteComponent } from "@/client/components/not-found";
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

export function createTabRouter({ pathname }: { pathname: string }) {
  return createTanStackRouter({
    context: { queryClient: sharedQueryClient },
    defaultErrorComponent: DefaultErrorComponent,
    defaultNotFoundComponent: NotFoundRouteComponent,
    defaultPreload: false,
    history: createMemoryHistory({ initialEntries: [pathname] }),
    routeTree,
    scrollRestoration: true,
  });
}

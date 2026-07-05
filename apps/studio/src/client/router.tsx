import type { RouterHistory } from "@tanstack/react-router";

import { DefaultErrorComponent } from "@/client/components/default-error-component";
import { NotFoundRouteComponent } from "@/client/components/not-found";
import { QueryClient } from "@tanstack/react-query";
import {
  createHashHistory,
  createRouter as createTanStackRouter,
} from "@tanstack/react-router";

import { captureComponentError, capturePageView } from "./lib/telemetry";
import { routeTree } from "./routeTree.gen";

function createRouter(options?: { history?: RouterHistory }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // 99% of queries are local RPC and won't fix if we retry. Zero retries
        // ensures fast error states. Exceptions for remote API calls are set in
        // rpc/client.ts.
        retry: 0,
      },
    },
  });

  const router = createTanStackRouter({
    context: { queryClient },
    defaultErrorComponent: DefaultErrorComponent,
    defaultNotFoundComponent: NotFoundRouteComponent,
    defaultOnCatch: captureComponentError,
    defaultPreload: false, // 99% of data is local, so no preload. We preload JS for certain routs in _app/route.tsx.
    history: options?.history,
    routeTree,
    scrollRestoration: true,
  });

  router.subscribe("onRendered", () => {
    capturePageView();
  });

  return {
    queryClient,
    router,
  };
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createRouter>["router"];
  }
}

const history = createHashHistory({});

export const { queryClient, router } = createRouter({ history });

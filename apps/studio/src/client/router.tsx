import type { RouterHistory } from "@tanstack/react-router";

import { DefaultErrorComponent } from "@/client/components/default-error-component";
import { NotFoundRouteComponent } from "@/client/components/not-found";
import { QueryClient } from "@tanstack/react-query";
import {
  createHashHistory,
  createRouter as createTanStackRouter,
} from "@tanstack/react-router";

import { LOCAL_RPC_DEFAULTS } from "./lib/local-rpc-defaults";
import { shouldRestoreScroll } from "./lib/scroll-restoration";
import { captureComponentError } from "./lib/capture-exception";
import { routeTree } from "./routeTree.gen";

function createRouter(options?: { history?: RouterHistory }) {
  const queryClient = new QueryClient({ defaultOptions: LOCAL_RPC_DEFAULTS });

  const router = createTanStackRouter({
    context: { queryClient },
    defaultErrorComponent: DefaultErrorComponent,
    defaultNotFoundComponent: NotFoundRouteComponent,
    defaultOnCatch: captureComponentError,
    // Preload is opt-in per link (`preload="intent"`); a global default would
    // also run loaders with side effects on hover.
    defaultPreload: false,
    history: options?.history,
    routeTree,
    scrollRestoration: shouldRestoreScroll,
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

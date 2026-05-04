import type { FileRoutesByPath, RouterHistory } from "@tanstack/react-router";

import { DefaultErrorComponent } from "@/client/components/default-error-component";
import { NotFoundRouteComponent } from "@/client/components/not-found";
import { QueryClient } from "@tanstack/react-query";
import {
  createHashHistory,
  createRouter as createTanStackRouter,
} from "@tanstack/react-router";

import { capturePageView } from "./lib/telemetry";
import { routeTree } from "./routeTree.gen";

const IGNORED_PATHS = new Set<keyof FileRoutesByPath>([
  "/sidebar", // Always rendered as separate view in Electron app
]);

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
    defaultPreload: false, // 99% of data is local, so no preload. We preload JS for certain routs in _app/route.tsx.
    history: options?.history,
    routeTree,
    scrollRestoration: true,
  });

  router.subscribe("onRendered", (event) => {
    if (
      IGNORED_PATHS.has(event.toLocation.pathname as keyof FileRoutesByPath)
    ) {
      return;
    }
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

window.api.onNavigate((url) => {
  const currentPath = router.state.location.pathname;
  if (currentPath === url) {
    const matches = router.matchRoutes(url, {});
    const projectRouteMatch = matches.find(
      (m) => m.routeId === "/_app/projects/$subdomain/",
    );
    if (projectRouteMatch) {
      // Same pathname as IPC: keep search params (bare path would strip them)
      // except clear `sidebar` so the default chat sidebar shows again.
      const loc = router.state.location;
      const subdomain = projectRouteMatch.params.subdomain;
      if (
        (loc.search.sidebar !== undefined ||
          loc.search.artifactPanel !== undefined) &&
        subdomain
      ) {
        void router.navigate({
          params: { subdomain },
          replace: true,
          search: (prev) => ({
            ...prev,
            artifactPanel: undefined,
            sidebar: undefined,
          }),
          to: "/projects/$subdomain",
        });
      }
      return;
    }
  }
  void router.navigate({ to: url });
});

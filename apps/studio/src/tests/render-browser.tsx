import { TooltipProvider } from "@/client/components/ui/tooltip";
import { ICON_CONTEXT_VALUE } from "@/client/lib/icon-context";
import { IconContext } from "@phosphor-icons/react/dist/lib/context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { createStore, Provider as JotaiProvider } from "jotai";
import { type ReactNode } from "react";
import { render, type RenderResult } from "vitest-browser-react";

/**
 * A router that routes nothing.
 *
 * `InternalLink` and everything built on it reads the router off context and
 * throws without one, but nothing in this project navigates: the components
 * under test are rendered directly, not reached through a route. So one
 * context-only router is shared by every render rather than each test standing
 * up a route tree it never uses.
 */
const router = createRouter({
  history: createMemoryHistory({ initialEntries: ["/"] }),
  routeTree: createRootRoute(),
});

/**
 * Render a component in the browser project with the providers it can expect
 * to find in the app.
 *
 * The sibling of `renderWithProviders` in [render.tsx](./render.tsx), for the
 * project that runs in real Chromium. It differs in two ways that follow from
 * where it runs. It is async, because `vitest-browser-react` awaits the React
 * root. And it supplies the router, which the jsdom helper deliberately does
 * not: there a component with a link is the exception, here the components
 * worth the cost of a browser are whole rows and panes, and nearly all of them
 * carry one.
 *
 * Each call gets a fresh Jotai store and query cache, so module-level atom
 * families do not carry a value from one test into the next. Pass `store` to
 * share one across renders within a test.
 *
 * The icon context is here for the same reason as the stylesheet: without it
 * icons render undecorated, and an accessibility-tree assertion would then be
 * reading a tree the app never produces.
 *
 * The result is the render result itself, locators included, plus the store and
 * query client for tests that seed or read them.
 */
export async function renderInBrowser(
  ui: ReactNode,
  { store = createStore() }: { store?: ReturnType<typeof createStore> } = {},
): Promise<
  RenderResult & {
    queryClient: QueryClient;
    store: ReturnType<typeof createStore>;
  }
> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={store}>
        <RouterContextProvider router={router}>
          <IconContext.Provider value={ICON_CONTEXT_VALUE}>
            <TooltipProvider>{children}</TooltipProvider>
          </IconContext.Provider>
        </RouterContextProvider>
      </JotaiProvider>
    </QueryClientProvider>
  );

  const result = await render(ui, { wrapper });

  return { ...result, queryClient, store };
}

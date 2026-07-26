import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import { type ReactElement, type ReactNode } from "react";

/**
 * What a test gets back, spelled out rather than widened from Testing Library's
 * own `RenderResult`. Queries belong on `screen`, which is what Testing Library
 * recommends and what keeps a test reading like the page rather than like a
 * render call, so the handful of things a caller genuinely needs are named here
 * instead.
 */
interface RenderWithProvidersResult {
  container: HTMLElement;
  queryClient: QueryClient;
  rerender: (ui: ReactElement) => void;
  store: ReturnType<typeof createStore>;
  unmount: () => void;
}

/**
 * Render a component with the providers it can expect to find in the app.
 *
 * Each call gets a fresh Jotai store and query cache, so module-level atom
 * families (the prompt drafts, the modals, the tab registry) do not carry a
 * value from one test into the next. The store comes back for tests that need to
 * seed or read an atom directly.
 *
 * Not provided: the router. Anything rendering an `InternalLink` needs one, and
 * standing up a real route tree is worth doing per-test rather than for every
 * caller here.
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
): RenderWithProvidersResult {
  const store = createStore();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={store}>{children}</JotaiProvider>
    </QueryClientProvider>
  );

  const { container, rerender, unmount } = render(ui, {
    ...options,
    wrapper,
  });

  return { container, queryClient, rerender, store, unmount };
}

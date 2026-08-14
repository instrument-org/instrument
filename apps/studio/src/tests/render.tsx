import { TooltipProvider } from "@/client/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import { createStore, getDefaultStore, Provider as JotaiProvider } from "jotai";
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
 * Render the way the app itself runs: with no Jotai `Provider` at all, so
 * `useStore()` resolves to the default store.
 *
 * Use this whenever the code under test writes through `getDefaultStore()`
 * rather than through a hook -- every `openX()` modal setter does. Under
 * {@link renderWithProviders} those writes land in a store the returned one
 * knows nothing about, so an assertion that the modal opened fails for a reason
 * that has nothing to do with the code, and an assertion that it *didn't* open
 * passes no matter what.
 *
 * The default store is global, so it carries values between tests. The dom
 * setup clears the app-wide modal slot after each one; anything else this test
 * writes there, it resets itself.
 */
export function renderWithDefaultStore(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
): RenderWithProvidersResult {
  return renderWith({ options, store: null, ui });
}

/**
 * Render a component with the providers it can expect to find in the app.
 *
 * Each call gets a fresh Jotai store and query cache, so module-level atom
 * families (the prompt drafts, the modals, the tab registry) do not carry a
 * value from one test into the next. The store comes back for tests that need to
 * seed or read an atom directly.
 *
 * Also provided: the tooltip provider, which the app mounts once at its root and
 * anything carrying a tooltip throws without.
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
  return renderWith({ options, store, ui });
}

function renderWith({
  options,
  store,
  ui,
}: {
  options?: Omit<RenderOptions, "wrapper">;
  store: null | ReturnType<typeof createStore>;
  ui: ReactElement;
}): RenderWithProvidersResult {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  // The tooltip provider is here for the same reason the app mounts exactly one
  // at its root: a tooltip anywhere under it throws without one, and an icon
  // button that carries its label in a tooltip is a shape any component can
  // reach for. Its sibling in `render-browser.tsx` supplies one too.
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {store ? (
          <JotaiProvider store={store}>{children}</JotaiProvider>
        ) : (
          children
        )}
      </TooltipProvider>
    </QueryClientProvider>
  );

  const { container, rerender, unmount } = render(ui, {
    ...options,
    wrapper,
  });

  return {
    container,
    queryClient,
    rerender,
    store: store ?? getDefaultStore(),
    unmount,
  };
}

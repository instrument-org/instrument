import type { BrowserCommand } from "vitest/node";

/**
 * The node half of `ariaSnapshot` (see [../aria-snapshot.ts](../aria-snapshot.ts)
 * for the half a test calls). Registered in `vitest.config.ts`.
 *
 * Playwright can serialize an accessibility tree, Vitest's browser API cannot,
 * and the commands API is the documented seam between them: this runs in the
 * Vitest node process, where the provider's Playwright objects live.
 *
 * The locator has to be resolved against `context.iframe`, not `context.page`.
 * The page is the orchestrator's own HTML and the test's DOM is one frame
 * inside it, so a snapshot taken at the page level describes the harness.
 */
export const ariaSnapshot: BrowserCommand<[selector: string], string> = (
  context,
  selector,
) => {
  if (context.provider.name !== "playwright") {
    throw new Error(
      `ariaSnapshot needs the playwright provider, got ${context.provider.name}.`,
    );
  }

  return context.iframe.locator(selector).ariaSnapshot();
};

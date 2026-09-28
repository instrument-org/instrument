import { createFileRoute } from "@tanstack/react-router";

/**
 * A site opened at the window's own level, by the group its page is kept
 * in. Drawn by the layout, which holds the page under the row a chat's page
 * wears; the route itself has nothing to draw.
 */
export const Route = createFileRoute("/orchestrator/page")({
  component: () => null,
});

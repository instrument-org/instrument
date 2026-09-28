import { createFileRoute } from "@tanstack/react-router";

/**
 * The chat with no chat open: the inbox across the tab. Drawn by the layout,
 * which draws every chat; the route itself has nothing to draw.
 */
export const Route = createFileRoute("/orchestrator/")({
  component: () => null,
});

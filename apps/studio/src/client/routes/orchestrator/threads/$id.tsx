import { createFileRoute } from "@tanstack/react-router";

/**
 * A thread's own tab. The screen is drawn by the stage the layout keeps
 * every lately shown thread mounted on, so a thread come back to is the
 * transcript as it was; the route itself has nothing to draw.
 */
export const Route = createFileRoute("/orchestrator/threads/$id")({
  component: () => null,
});

import { createFileRoute } from "@tanstack/react-router";

/**
 * A chat's own tab. The screen is drawn by the layout around it, which
 * reads the chat from this address; the route itself has nothing to draw.
 */
export const Route = createFileRoute("/orchestrator/chats/$id")({
  component: () => null,
});

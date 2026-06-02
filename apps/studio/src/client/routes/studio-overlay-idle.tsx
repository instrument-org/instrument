import { createFileRoute } from "@tanstack/react-router";

/**
 * Parking route for the app-wide modal's warm WebContentsView. The view is
 * created on first open and kept alive (hidden) afterwards so reopening is
 * instant. While hidden, the controller navigates it here instead of leaving
 * it on an `/studio-overlay/*` route: this route renders nothing and mounts no
 * layout, so the modal's live queries (update status), Toaster, and dialog all
 * unmount and do no background work. The renderer process stays warm; only the
 * DOM/React tree goes idle.
 */
export const Route = createFileRoute("/studio-overlay-idle")({
  component: () => null,
});

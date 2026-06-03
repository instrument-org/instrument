import { rpcClient } from "@/client/rpc/client";
import { createFileRoute } from "@tanstack/react-router";

/**
 * Where the warm overlay view parks while hidden: renders no layout, so its
 * live queries, Toaster, and dialog all unmount while the renderer stays warm.
 * The transparent full-window button is a safety net: if the view is ever left
 * visible here, the user can click anywhere to dismiss rather than being
 * trapped behind a blank surface.
 */
export const Route = createFileRoute("/studio-overlay-idle")({
  component: IdleParkingRoute,
});

function IdleParkingRoute() {
  return (
    <button
      aria-label="Dismiss"
      className="fixed inset-0 size-full cursor-default bg-transparent outline-none"
      onClick={() => {
        void rpcClient.studioOverlay.dismiss.call();
      }}
      type="button"
    />
  );
}

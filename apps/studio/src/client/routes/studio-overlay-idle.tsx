import { rpcClient } from "@/client/rpc/client";
import { createFileRoute, type FileRoutesByPath, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

const PRELOAD_ROUTE_PATHS = [
  "/studio-overlay/login",
  "/studio-overlay/settings",
  "/studio-overlay/welcome",
] satisfies (keyof FileRoutesByPath)[];

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
  const router = useRouter();

  useEffect(() => {
    async function preloadRouteChunks() {
      for (const path of PRELOAD_ROUTE_PATHS) {
        await router.loadRouteChunk(router.routesByPath[path]);
      }
    }

    void preloadRouteChunks();
  }, [router]);

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

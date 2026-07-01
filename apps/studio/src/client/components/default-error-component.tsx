import type { ErrorComponentProps } from "@tanstack/react-router";

import { isStudioOverlayWindow } from "@/client/lib/studio-overlay";
import { rpcClient } from "@/client/rpc/client";

import { ErrorCard } from "./error-card";

export function DefaultErrorComponent({ error }: ErrorComponentProps) {
  // In the overlay view the wrapper is the full-window backdrop; clicking it
  // (outside the card) dismisses, matching how modals close on outside-click.
  return (
    <div
      className="flex min-h-full min-w-0 flex-1 items-center justify-center p-6"
      onClick={
        isStudioOverlayWindow()
          ? (event) => {
              if (event.target === event.currentTarget) {
                void rpcClient.studioOverlay.dismiss.call();
              }
            }
          : undefined
      }
    >
      <ErrorCard error={error} />
    </div>
  );
}

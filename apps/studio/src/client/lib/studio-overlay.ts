import { rpcClient } from "@/client/rpc/client";
import { type StudioOverlaySettingsProps } from "@/shared/studio-overlay";

export function dismissStudioOverlay() {
  void rpcClient.studioOverlay.dismiss.call();
}

/** Open the in-app login modal, replacing any modal already showing. */
export function openLogin() {
  void rpcClient.studioOverlay.show.call({ kind: "login" });
}

/** Open the in-app settings modal, optionally deep-linked to a section. */
export function openSettings(props?: StudioOverlaySettingsProps) {
  void rpcClient.studioOverlay.show.call({ kind: "settings", props });
}

/** Report that the overlay's flow completed successfully. */
export function resolveStudioOverlay() {
  void rpcClient.studioOverlay.resolve.call();
}

import { coveringOverlayCountAtom } from "@/client/atoms/guest-coverage";
import { useStore } from "jotai";
import { useEffect } from "react";

/**
 * Registers the caller as a full-window overlay for as long as it is mounted, so
 * a host showing a browser guest parks it (see `useIsGuestCovered`).
 *
 * Called by the overlay components themselves rather than by each modal. The
 * guest is a `<webview>` on `document.body`, outside every dialog's subtree, so
 * nothing occludes it and every dim layer has to say so; hanging that off the
 * element that *is* the dim layer means a new dialog cannot forget to, and the
 * answer stops being a list of the modals someone remembered.
 *
 * Mounted, not open: Radix keeps an overlay mounted through its close animation,
 * so the guest stays parked until the dim layer is actually gone rather than
 * popping back through it mid-fade.
 */
export function useCoversGuests() {
  const store = useStore();
  useEffect(() => {
    store.set(coveringOverlayCountAtom, (count) => count + 1);
    return () => {
      store.set(coveringOverlayCountAtom, (count) => count - 1);
    };
  }, [store]);
}

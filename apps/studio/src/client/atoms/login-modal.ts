import { studioModalAtom } from "@/client/atoms/studio-modal";
import { getDefaultStore } from "jotai";

export interface LoginModalProps {
  // Hide the manual-provider option (caller only wants account login).
  hideManualProvider?: boolean;
  // Open straight to the add-provider form because a provider is required.
  reason?: "provider-required";
}

interface LoginModalState {
  // Called when the user finishes the flow (logs in / adds a provider), not on
  // dismiss.
  onCompleted?: () => void;
  props?: LoginModalProps;
}

/**
 * Drives the app-wide login / add-provider modal. `<LoginModal />` at the
 * app-chrome root reads it; `openLogin` sets it. Opening it replaces any other
 * studio modal (e.g. settings, whose account/provider sections trigger it).
 */
export const loginModalAtom = studioModalAtom<LoginModalState>();

export function openLogin(props?: LoginModalProps, onCompleted?: () => void) {
  getDefaultStore().set(loginModalAtom, { onCompleted, props });
}

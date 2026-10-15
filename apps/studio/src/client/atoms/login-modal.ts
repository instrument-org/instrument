import { studioModalAtom } from "@/client/atoms/studio-modal";
import { getDefaultStore } from "jotai";

export interface LoginModalProps {
  // Offer only the Instrument account login: no ChatGPT, Claude, or manual
  // provider, for callers that mean signing in to Instrument itself.
  instrumentOnly?: boolean;
  // Why it opened: `provider-required` goes straight to the providers to add,
  // and `dictation` says that signing in is what dictation needs.
  reason?: "dictation" | "provider-required";
}

interface LoginModalState {
  // Called when the user finishes the flow (logs in / adds a provider), not on
  // dismiss.
  onCompleted?: () => void;
  props?: LoginModalProps;
}

/**
 * Drives the app-wide login / add-provider modal. `<LoginModal />` at the
 * window root reads it; `openLogin` sets it. Opening it replaces any other
 * studio modal (e.g. settings, whose account/provider sections trigger it).
 */
export const loginModalAtom = studioModalAtom<LoginModalState>();

export function openLogin(props?: LoginModalProps, onCompleted?: () => void) {
  getDefaultStore().set(loginModalAtom, { onCompleted, props });
}

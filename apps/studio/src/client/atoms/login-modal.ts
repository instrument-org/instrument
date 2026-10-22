import { studioModalAtom } from "@/client/atoms/studio-modal";
import { getDefaultStore } from "jotai";

export interface LoginModalProps {
  // Offer only the Instrument account login: no ChatGPT, Claude, or manual
  // provider, for callers that mean signing in to Instrument itself.
  // Otherwise the Add a provider sheet opens, with Instrument's free trial
  // in it while signed out.
  instrumentOnly?: boolean;
  // Why it opened: `dictation` says that signing in is what dictation needs.
  reason?: "dictation";
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

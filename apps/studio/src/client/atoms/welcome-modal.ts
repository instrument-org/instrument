import { atom, getDefaultStore } from "jotai";

/**
 * Whether the app-wide welcome modal is open. `<WelcomeModal />` at the
 * app-chrome root reads it; `openWelcome` sets it. Non-dismissible — it only
 * closes when the user hits Continue.
 */
export const welcomeModalAtom = atom(false);

export function openWelcome() {
  getDefaultStore().set(welcomeModalAtom, true);
}

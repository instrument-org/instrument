import { studioModalAtom } from "@/client/atoms/studio-modal";
import { getDefaultStore } from "jotai";

/**
 * Whether the app-wide welcome modal is open (`true` when open, `null` when
 * closed). `<WelcomeModal />` at the app-chrome root reads it; `openWelcome`
 * sets it. Non-dismissible — it only closes when the user hits Continue.
 */
export const welcomeModalAtom = studioModalAtom<true>();

export function openWelcome() {
  getDefaultStore().set(welcomeModalAtom, true);
}

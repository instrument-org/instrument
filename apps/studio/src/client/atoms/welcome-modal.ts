import { studioModalAtom } from "@/client/atoms/studio-modal";
import { getDefaultStore } from "jotai";

/**
 * Whether the app-wide welcome modal is open (`true` when open, `null` when
 * closed). `<WelcomeModal />` at the app-chrome root reads it; `openWelcome`
 * sets it. Non-dismissible — it only closes when the user hits Continue, and is
 * non-replaceable so another modal (e.g. settings via Cmd+,) can't tear the
 * onboarding gate down out from under the user.
 */
export const welcomeModalAtom = studioModalAtom<true>({ replaceable: false });

export function openWelcome() {
  getDefaultStore().set(welcomeModalAtom, true);
}

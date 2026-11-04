import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { atom, getDefaultStore, useAtomValue } from "jotai";

/** The band's height in layout px, which the toasts' corner stands clear of. */
export const DEVELOPER_STRIP_HEIGHT = 24;

/** Whether the band was closed, held only until the window reloads. */
export const developerStripHiddenAtom = atom(false);

/** Set to throw during the band's render, inside the window's error boundary. */
export const crashWindowAtom = atom(false);

export function toggleDeveloperStrip() {
  const store = getDefaultStore();
  store.set(developerStripHiddenAtom, !store.get(developerStripHiddenAtom));
}

/** Whether this window draws the band along its foot. */
export function useDeveloperStripShown() {
  const isDeveloperMode = useDeveloperMode();
  const isHidden = useAtomValue(developerStripHiddenAtom);
  return isDeveloperMode && !isHidden;
}

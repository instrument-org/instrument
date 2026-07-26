import { studioModalAtom } from "@/client/atoms/studio-modal";
import { getDefaultStore } from "jotai";

/**
 * Whether the app-wide shortcut guide is open (`true` when open, `null` when
 * closed). `<ShortcutGuideModal />` at the app-chrome root reads it; the Help
 * menu item and the `?` key both open it.
 *
 * Replaceable like any other studio modal, so `?` from a modal that must hold
 * its slot (the onboarding welcome gate) is ignored rather than tearing it
 * down. `useShortcutGuideHotkey` declines to open it over any modal at all --
 * this atom is the backstop for the paths that don't go through that key.
 */
export const shortcutGuideModalAtom = studioModalAtom<true>();

export function openShortcutGuide() {
  getDefaultStore().set(shortcutGuideModalAtom, true);
}

import { studioModalAtom } from "@/client/atoms/studio-modal";
import { getDefaultStore } from "jotai";

/**
 * Whether the keyboard shortcut guide is open (`true` when open, `null` when
 * closed). `<ShortcutGuideModal />` at the window root reads it; `?` and the
 * Help menu item open it.
 *
 * Replaceable like any other studio modal. `useShortcutGuideHotkey` declines
 * to open it over any modal at all; this atom is the backstop for the paths
 * that don't go through that key.
 */
export const shortcutGuideModalAtom = studioModalAtom<true>();

export function openShortcutGuide() {
  getDefaultStore().set(shortcutGuideModalAtom, true);
}

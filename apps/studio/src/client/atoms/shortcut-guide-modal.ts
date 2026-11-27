import { studioModalAtom } from "@/client/atoms/studio-modal";
import { getDefaultStore } from "jotai";

/**
 * Whether the keyboard shortcut guide is open (`true` when open, `null` when
 * closed). `<ShortcutGuideModal />` at the window root reads it; its chord,
 * the Help menu item and the command menu open it.
 *
 * Replaceable like any other studio modal.
 */
export const shortcutGuideModalAtom = studioModalAtom<true>();

export function openShortcutGuide() {
  getDefaultStore().set(shortcutGuideModalAtom, true);
}

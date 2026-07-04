import { studioModalAtom } from "@/client/atoms/studio-modal";
import { getDefaultStore } from "jotai";

export type SettingsTab =
  | "Debug"
  | "Features"
  | "General"
  | "Providers"
  | "Storage";

interface SettingsModalState {
  // Deep-link the Providers tab straight to the add-provider dialog.
  showNewProviderDialog?: boolean;
  tab?: SettingsTab;
}

/**
 * Drives the app-wide settings modal (`null` when closed). `<SettingsModal />`
 * at the app-chrome root reads it; `openSettings` sets it. The section shown is
 * internal state seeded from `tab`, not a route.
 */
export const settingsModalAtom = studioModalAtom<SettingsModalState>();

export function openSettings(props?: SettingsModalState) {
  getDefaultStore().set(settingsModalAtom, props ?? {});
}

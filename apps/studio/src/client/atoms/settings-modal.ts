import { studioModalAtom } from "@/client/atoms/studio-modal";
import { getDefaultStore } from "jotai";

export type SettingsTab =
  | "Debug"
  | "Features"
  | "General"
  | "Memory"
  | "Providers"
  | "Skills"
  | "Storage";

interface SettingsModalState {
  /** Open the General tab's diagnostic log viewer over Settings. */
  diagnosticLog?: boolean;
  /** The memory to bring into view on the Memory tab, by its name, for a link to one. */
  memory?: string;
  // Deep-link the Providers tab straight to the add-provider dialog.
  showNewProviderDialog?: boolean;
  tab?: SettingsTab;
}

/**
 * Drives the app-wide settings modal (`null` when closed). `<SettingsModal />`
 * at the window root reads it; `openSettings` sets it. The section shown is
 * internal state seeded from `tab`, not a route.
 */
export const settingsModalAtom = studioModalAtom<SettingsModalState>();

export function openSettings(props?: SettingsModalState) {
  getDefaultStore().set(settingsModalAtom, props ?? {});
}

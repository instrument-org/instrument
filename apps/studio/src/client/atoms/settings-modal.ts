import { studioModalAtom } from "@/client/atoms/studio-modal";
import { getDefaultStore } from "jotai";

export type SettingsTab =
  | "Activity"
  | "Debug"
  | "Features"
  | "General"
  | "Memory"
  | "Permissions"
  | "Providers"
  | "Skills"
  | "Storage";

interface SettingsModalState {
  /** Expand the account's usage panel on the Providers tab. */
  providerUsage?: "claude-account";
  /** Open the General tab's diagnostic log viewer over Settings. */
  diagnosticLog?: boolean;
  /** A memory a link named, by its name, which the Memory tab says is gone when no file has it. */
  memory?: string;
  /**
   * The setting to bring into view and light, by the name a link gives it: a
   * row's id, a page's name, or words to search for (`settingsTargetOf`).
   */
  setting?: string;
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

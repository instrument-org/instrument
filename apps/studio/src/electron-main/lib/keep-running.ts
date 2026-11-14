import { getMachinePreferences } from "@/electron-main/stores/machine/preferences";

/**
 * Whether the app keeps running behind its menu bar or tray icon once its
 * windows are gone, as Settings › General sets it for this computer.
 */
export function keepsRunningInMenuBar(): boolean {
  return getMachinePreferences().get("keepRunningInMenuBar");
}

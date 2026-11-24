import { getMachinePreferences } from "@/electron-main/stores/machine/preferences";

/**
 * Whether the app keeps running behind its menu bar or tray icon once its
 * windows are gone, as Settings › General sets it for this computer.
 */
export function keepsRunningInMenuBar(): boolean {
  return getMachinePreferences().get("keepRunningInMenuBar");
}

let menuBarShown = false;

/** Records whether the menu bar or tray icon is up, which `startMenuBar` puts up once a workspace has started. */
export function setMenuBarShown(shown: boolean) {
  menuBarShown = shown;
}

/**
 * Whether the menu bar or tray icon is up to bring a window back. Off before
 * a workspace has started, as during setup, and while the setting is off.
 */
export function isMenuBarShown(): boolean {
  return menuBarShown;
}

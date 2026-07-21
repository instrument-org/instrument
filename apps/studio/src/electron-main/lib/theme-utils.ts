import { RESOLVE_THEME_CHANNEL } from "@/shared/constants";
import { ipcMain, nativeTheme } from "electron";

import { getPreferencesStore } from "../stores/preferences";

export function getBackgroundColor() {
  // Must be manually synced with globals.css var(--background) (gray-900 / gray-50).
  return shouldUseDarkMode() ? "#1c1917" : "#fafaf9";
}

export function getMainWindowBackgroundColor() {
  return getBackgroundColor();
}

/**
 * Answers the preload's synchronous request for the resolved theme. The app's
 * stylesheet is render-blocking, so it paints `body { background:
 * var(--background) }` as soon as it loads -- in light mode, since the class
 * that picks the theme only arrives once the renderer bundle has compiled. That
 * is a white flash on a dark-mode launch. The preload runs before the document
 * is parsed, which makes it the only place that can set the class first, and
 * this is where it gets the answer from.
 */
export function serveResolvedTheme() {
  ipcMain.on(RESOLVE_THEME_CHANNEL, (event) => {
    event.returnValue = shouldUseDarkMode() ? "dark" : "light";
  });
}

export function watchThemePreferenceAndApply(callback?: () => void): void {
  const preferencesStore = getPreferencesStore();
  applyNativeThemeFromPreferences();
  preferencesStore.onDidChange("theme", () => {
    applyNativeThemeFromPreferences();
    callback?.();
  });
}

function applyNativeThemeFromPreferences(): void {
  const preferencesStore = getPreferencesStore();
  const theme = preferencesStore.get("theme");
  nativeTheme.themeSource = theme;
}

function shouldUseDarkMode(): boolean {
  const preferencesStore = getPreferencesStore();
  const theme = preferencesStore.get("theme");

  switch (theme) {
    case "dark": {
      return true;
    }
    case "light": {
      return false;
    }
    case "system": {
      return nativeTheme.shouldUseDarkColors;
    }
    default: {
      return false;
    }
  }
}

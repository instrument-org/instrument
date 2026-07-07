import { nativeTheme } from "electron";

import { getPreferencesStore } from "../stores/preferences";

export function getBackgroundColor() {
  // Must be manually synced with globals.css var(--background) (gray-900 / gray-50).
  return shouldUseDarkMode() ? "#1c1917" : "#fafaf9";
}

export function getMainWindowBackgroundColor() {
  return getBackgroundColor();
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

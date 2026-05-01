import { TOOLBAR_HEIGHT } from "@/shared/constants";
import { nativeTheme } from "electron";

import { getPreferencesStore } from "../stores/preferences";

export function getBackgroundColor() {
  // Must be manually synced with app.css var(--background).
  return shouldUseDarkMode() ? "#1c1917" : "#fafaf9";
}

export function getMainWindowBackgroundColor() {
  return getBackgroundColor();
}

export function getTitleBarOverlay() {
  const isDark = shouldUseDarkMode();
  // Windows and Linux include a 1px border in the overlay height that is not
  // part of the CSS content area, causing a 1px overlap with the tab bar.
  const height =
    process.platform === "darwin" ? TOOLBAR_HEIGHT : TOOLBAR_HEIGHT - 1;
  return {
    // Must be manually synced with app.css var(--card) / var(--border).
    color: isDark ? "#292524" : "#e7e5e4",
    height,
    // Must be manually synced with app.css var(--foreground).
    symbolColor: isDark ? "#ffffff" : "#171412",
  };
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

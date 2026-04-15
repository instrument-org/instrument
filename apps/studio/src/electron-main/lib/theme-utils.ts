import { TOOLBAR_HEIGHT } from "@/shared/constants";
import { nativeTheme } from "electron";

import { getPreferencesStore } from "../stores/preferences";

export function getBackgroundColor() {
  // Must be manually synced with app.css var(--background)
  return shouldUseDarkMode() ? "#18191b" : "#f9f9fb";
}

export function getMainWindowBackgroundColor() {
  if (process.platform === "darwin") {
    return;
  }

  return getBackgroundColor();
}

export function getTitleBarOverlay() {
  const isDark = shouldUseDarkMode();
  // Windows and Linux include a 1px border in the overlay height that is not
  // part of the CSS content area, causing a 1px overlap with the tab bar.
  const height =
    process.platform === "darwin" ? TOOLBAR_HEIGHT : TOOLBAR_HEIGHT - 1;
  return {
    color: isDark ? "#272a2d" : "#e7e8ec",
    height,
    symbolColor: isDark ? "#ffffff" : "#3f3f3f",
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

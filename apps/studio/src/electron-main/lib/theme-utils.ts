import { BOOT_SHELL_COLORS } from "@/shared/boot-shell";
import { nativeTheme } from "electron";

import { getPreferencesStore } from "../stores/preferences";

export function getBackgroundColor() {
  // A window paints this before its contents load, so it is the same surface the
  // boot shell then draws on.
  return shouldUseDarkMode()
    ? BOOT_SHELL_COLORS.dark.background
    : BOOT_SHELL_COLORS.light.background;
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

import { publisher } from "@/electron-main/rpc/publisher";
import { getWorkspacePreferences } from "@/electron-main/stores/workspace/preferences";
import { RESOLVE_THEME_CHANNEL } from "@/shared/constants";
import { ipcMain, nativeTheme } from "electron";

export function getBackgroundColor() {
  // Must be manually synced with globals.css var(--background) (gray-900 / gray-50).
  return shouldUseDarkMode() ? "#1c1917" : "#fafaf9";
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

/** What else follows the theme, once `watchThemePreferenceAndApply` names it. */
let onThemeApplied: (() => void) | undefined;

/**
 * Applies the theme the open workspace's preferences name, and again
 * whenever they change: through the preferences' event rather than one
 * store's, so it follows whichever workspace is open.
 */
export function watchThemePreferenceAndApply(callback?: () => void): void {
  onThemeApplied = callback;
  applyThemePreference();
  publisher.subscribe("preferences.updated", () => {
    if (nativeTheme.themeSource !== getWorkspacePreferences().get("theme")) {
      applyThemePreference();
    }
  });
}

/** Applies the open workspace's theme, as a switch to another one has to. */
export function applyThemePreference(): void {
  nativeTheme.themeSource = getWorkspacePreferences().get("theme");
  onThemeApplied?.();
}

function shouldUseDarkMode(): boolean {
  const preferencesStore = getWorkspacePreferences();
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

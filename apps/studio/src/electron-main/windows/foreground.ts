import { getAppWindow } from "@/electron-main/windows/app-window";
import { getOnboardingWindow } from "@/electron-main/windows/onboarding";
import { type BrowserWindow } from "electron";

/**
 * The window the app comes forward as when something outside it asks: a deep
 * link, a sign-in that finished in the browser, a second launch.
 *
 * First run owns the screen while the onboarding window is up; after that it
 * is the app window.
 *
 * A read of the windows that already exist, and nothing more. Putting one on
 * screen is `ensureForegroundWindowVisible`, which lives apart because it
 * reaches the factories a window is built from; asking which window is in front
 * costs nothing and is done from all over the main process.
 */
export function getForegroundWindow(): BrowserWindow | null {
  const onboardingWindow = getOnboardingWindow();
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    return onboardingWindow;
  }
  return getAppWindow();
}

/**
 * Bring the foreground window to the front, as a sign-in that finished in the
 * browser does, so the person lands back where they started.
 */
export function focusAppWindow() {
  const target = getForegroundWindow();
  if (target) {
    if (target.isMinimized()) {
      target.restore();
    }
    target.show();
    // Temporarily set always-on-top to reliably bring window to front on Windows
    target.setAlwaysOnTop(true);
    target.focus();
    target.setAlwaysOnTop(false);
  }
}

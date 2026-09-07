import { isFeatureEnabled } from "@/electron-main/stores/features";
import { getMainWindow } from "@/electron-main/windows/main/instance";
import { getOnboardingWindow } from "@/electron-main/windows/onboarding";
import { getOrchestratorWindow } from "@/electron-main/windows/orchestrator";
import { type BrowserWindow } from "electron";

/**
 * The window the app comes forward as when something outside it asks: a deep
 * link, a sign-in that finished in the browser, a second launch.
 *
 * First run owns the screen while the onboarding window is up. Under Instrument
 * 2.0 the 2.0 window is the app, and the classic window is open only to hold
 * the tasks' machinery and kept out of sight, so bringing that one forward
 * would put a window the user never asked for over the one they are in.
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

  if (isFeatureEnabled("instrument_2")) {
    const orchestratorWindow = getOrchestratorWindow();
    if (orchestratorWindow) {
      return orchestratorWindow;
    }
  }

  const mainWindow = getMainWindow();
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

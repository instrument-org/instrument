import { isFeatureEnabled } from "@/electron-main/stores/features";
import { ensureMainWindowVisible } from "@/electron-main/windows/main";
import { getMainWindow } from "@/electron-main/windows/main/instance";
import { getOnboardingWindow } from "@/electron-main/windows/onboarding";
import {
  getOrchestratorWindow,
  openOrchestratorWindow,
} from "@/electron-main/windows/orchestrator";
import { type BrowserWindow } from "electron";

/**
 * Put the foreground window ({@link getForegroundWindow}) on screen, making one
 * if none is left. For the paths that have to leave the user somewhere: a
 * canceled quit, a deep link that arrived with every window closed. Outside
 * macOS a process with no window can't be reached again at all, so none of them
 * may end with nothing shown.
 *
 * The classic window is not that somewhere under Instrument 2.0. It is open
 * only to hold the tasks' machinery, and revealing it answers the user with a
 * window they never asked for; the 2.0 window is opened again instead.
 */
export async function ensureForegroundWindowVisible() {
  const target = getForegroundWindow();
  if (target && target !== getMainWindow()) {
    if (target.isMinimized()) {
      target.restore();
    }
    if (!target.isVisible()) {
      target.show();
    }
    target.focus();
    return;
  }

  if (isFeatureEnabled("instrument_2")) {
    openOrchestratorWindow();
    return;
  }
  await ensureMainWindowVisible();
}

/**
 * The window the app comes forward as when something outside it asks: a deep
 * link, a sign-in that finished in the browser, a second launch.
 *
 * First run owns the screen while the onboarding window is up. Under Instrument
 * 2.0 the 2.0 window is the app, and the classic window is open only to hold
 * the tasks' machinery and kept out of sight, so bringing that one forward
 * would put a window the user never asked for over the one they are in.
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

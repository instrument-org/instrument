import { isFeatureEnabled } from "@/electron-main/stores/features";
import { getForegroundWindow } from "@/electron-main/windows/foreground";
import { ensureMainWindowVisible } from "@/electron-main/windows/main";
import { getMainWindow } from "@/electron-main/windows/main/instance";
import { openOrchestratorWindow } from "@/electron-main/windows/orchestrator";

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

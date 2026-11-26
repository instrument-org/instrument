import { shouldShowARM64TranslationWarning } from "@/electron-main/lib/arm64-translation-warning";
import { logBootMark } from "@/electron-main/lib/boot-timing";
import { relaunchViewOf } from "@/electron-main/lib/idle-restart-policy";
import { asksToMoveToApplications } from "@/electron-main/lib/move-to-applications";
import { applyNativeThemeFromPreferences } from "@/electron-main/lib/theme-utils";
import { isSetupSettled } from "@/electron-main/lib/setup-state";
import { getWorkspaceRefusal } from "@/electron-main/lib/workspace-refusal";
import { peekRelaunchMarker } from "@/electron-main/stores/machine/state";
import { FIRST_APP_WINDOW_ID } from "@/electron-main/stores/workspace/kept-state";
import {
  getAppZoom,
  rememberedWindowIds,
} from "@/electron-main/stores/workspace/window-state";
import {
  appWindowOptions,
  rememberedStateOf,
} from "@/electron-main/windows/app-window-options";
import { putOnScreen } from "@/electron-main/windows/on-screen";
import { setTrafficLightForZoom } from "@/electron-main/windows/traffic-lights";
import { WINDOW_CARD_GAP } from "@/shared/constants";
import { app, BrowserWindow } from "electron";

/**
 * The windows a launch brings back, the one last in front at the end: every
 * window the workspace was left with, or the one closed last where all of
 * them were closed.
 */
export function launchWindowIds(): string[] {
  const { closed, open } = rememberedWindowIds(FIRST_APP_WINDOW_ID);
  return open.length > 0 ? open : [closed[0] ?? FIRST_APP_WINDOW_ID];
}

/** The launch's first window, up before the rest of main has loaded. */
let early: { id: string; window: BrowserWindow } | undefined;

/**
 * Puts the window the launch brings back in front on screen as soon as
 * Electron is ready, at its place and size and in the theme's background,
 * while the rest of the main process loads and boots. Its page loads once
 * boot adopts it (`takeEarlyWindow`), as any window's does.
 *
 * Only on a launch that comes up as usual: not where setup can still come up
 * (its window opens at setup's size), a workspace is refused, a dialog asks
 * something first, or an automatic restart brings the windows back as they
 * were left.
 */
export function showEarlyWindow() {
  if (!opensAsUsual()) {
    return;
  }
  // Its frame follows the theme from the start, as its background does.
  applyNativeThemeFromPreferences();
  const id = launchWindowIds().at(-1) ?? FIRST_APP_WINDOW_ID;
  const remembered = rememberedStateOf(id);
  const window = new BrowserWindow(
    appWindowOptions(id, { bounds: remembered.bounds, isSpare: false }),
  );
  try {
    setTrafficLightForZoom(window, getAppZoom(), WINDOW_CARD_GAP);
    putOnScreen(window, { maximized: remembered.isMaximized });
  } catch (error) {
    // Boot opens it as any other, rather than beside one that never came up.
    window.destroy();
    throw error;
  }
  early = { id, window };
  logBootMark(`window ${id} on screen`);
}

function opensAsUsual() {
  return (
    // A development run waits for the one it replaces to let go of the
    // window's profile (`waitForPreviousDevInstance`) before it opens it.
    !import.meta.env.DEV &&
    getWorkspaceRefusal() === undefined &&
    isSetupSettled() &&
    !asksToMoveToApplications() &&
    !shouldShowARM64TranslationWarning({
      arch: process.arch,
      isPackaged: app.isPackaged,
      platform: process.platform,
      runningUnderARM64Translation: app.runningUnderARM64Translation,
    }) &&
    relaunchViewOf({
      marker: peekRelaunchMarker(),
      now: Date.now(),
      platform: process.platform,
    }) === undefined
  );
}

/**
 * The early window, for boot to make the window it brings back under `id`,
 * once. None where it was not shown, is not that window, or was closed.
 * Boot closes one it does not take (`dropEarlyWindow`).
 */
export function takeEarlyWindow(id: string): BrowserWindow | undefined {
  if (early?.id !== id) {
    return undefined;
  }
  const { window } = early;
  early = undefined;
  return window.isDestroyed() ? undefined : window;
}

/** Closes the early window when boot brought the launch's windows back without it. */
export function dropEarlyWindow() {
  if (early && !early.window.isDestroyed()) {
    early.window.destroy();
  }
  early = undefined;
}

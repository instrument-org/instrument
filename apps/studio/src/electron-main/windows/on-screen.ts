import { is } from "@electron-toolkit/utils";
import { type BrowserWindow } from "electron";

/**
 * Whether studio-drive started this development run for an agent to drive.
 * Such a run shares the machine with the person at it, so its windows keep out
 * of their way: they render and take input without being on screen, and keep
 * drawing once covered, minimized, or on another Space, where Chromium would
 * otherwise stop painting a window and stop delivering input to it.
 */
export function isDrivenInstance() {
  return is.dev && Boolean(process.env.STUDIO_DRIVE_PURPOSE);
}

/**
 * Whether this run's windows wait off screen until someone asks for one.
 * `studio-drive boot --visible` puts them up as a development run would.
 */
function keepsOffScreen() {
  return isDrivenInstance() && process.env.STUDIO_DRIVE_VISIBLE !== "1";
}

/** What this module asks of a window, so a test can hand it a stand-in. */
type ScreenWindow = Pick<
  BrowserWindow,
  "isDestroyed" | "maximize" | "show" | "showInactive"
>;

/** Windows held off screen, each with whether it comes up maximized. */
const held = new Map<ScreenWindow, { maximized: boolean }>();

/**
 * Put a window made with `show: false` on screen the way this run should.
 *
 * A packaged build brings it to the front and gives it focus. A development
 * run brings it up without focus, since main-process rebuilds relaunch it over
 * and over while someone types elsewhere. A driven instance holds it off
 * screen: a window put up even without focus can land on a Space its display
 * is not showing, and macOS then scrolls the display there and hands focus to
 * whatever is in front on it.
 */
export function putOnScreen(
  window: ScreenWindow,
  { maximized = false }: { maximized?: boolean } = {},
) {
  if (keepsOffScreen()) {
    held.set(window, { maximized });
    return;
  }
  // Maximized only once there is a window to maximize: on Windows and Linux
  // maximizing one that has not been shown is itself what shows it, which
  // would put this window up before its first paint.
  if (maximized) {
    window.maximize();
  }
  if (is.dev) {
    window.showInactive();
  } else {
    window.show();
  }
}

/** Whether a window waits off screen for someone to ask for it. */
export function isHeldOffScreen(window: ScreenWindow) {
  return held.has(window);
}

/**
 * Put up every window held off screen, for a person who asked for the app by
 * clicking its Dock icon. Whether there were any.
 */
export function showHeldWindows() {
  const windows = [...held].filter(([window]) => !window.isDestroyed());
  held.clear();
  for (const [window, { maximized }] of windows) {
    if (maximized) {
      window.maximize();
    }
    window.show();
  }
  return windows.length > 0;
}

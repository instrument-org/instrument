import { type RelaunchView } from "@/electron-main/lib/idle-restart-policy";
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
  "isDestroyed" | "maximize" | "minimize" | "show" | "showInactive"
> & {
  once: (event: "focus", listener: () => void) => unknown;
  setAlwaysOnTop: (flag: boolean, level?: "normal", relative?: number) => void;
};

/** Windows held off screen, each with whether it comes up maximized. */
const held = new Map<ScreenWindow, { maximized: boolean }>();

/**
 * How the first window comes up on a launch that is the app restarting itself
 * to install an update while it was not in use: as it was left, and never
 * taking focus from whatever the person is doing.
 */
let relaunchView: RelaunchView | undefined;

/** Called once at launch, before any window, with what the restart left. */
export function comeBackAsLeft(view: RelaunchView | undefined) {
  relaunchView = view;
}

/**
 * Put a window made with `show: false` on screen the way this run should.
 *
 * A packaged build brings it to the front and gives it focus. A development
 * run brings it up without focus, since main-process rebuilds relaunch it over
 * and over while someone types elsewhere. A driven instance holds it off
 * screen: a window put up even without focus can land on a Space its display
 * is not showing, and macOS then scrolls the display there and hands focus to
 * whatever is in front on it. A launch that is the app restarting itself
 * brings it back as it was left (`comeBackAsLeft`), without focus.
 */
export function putOnScreen(
  window: ScreenWindow,
  { maximized = false }: { maximized?: boolean } = {},
) {
  const view = relaunchView;
  relaunchView = undefined;
  // A window left hidden waits the same way, until the Dock icon is clicked
  // (macOS only).
  if (keepsOffScreen() || view === "hidden") {
    held.set(window, { maximized });
    return;
  }
  if (view === "minimized") {
    window.minimize();
    return;
  }
  // Maximized only once there is a window to maximize: on Windows and Linux
  // maximizing one that has not been shown is itself what shows it, which
  // would put this window up before its first paint.
  if (maximized) {
    window.maximize();
  }
  if (view === "front") {
    // Left in view behind the app the person was using, so it comes back
    // behind it: `showInactive` alone orders it over every other app's
    // windows on macOS. One level under normal keeps it below them until it
    // is first focused, which puts it back at the normal level.
    if (process.platform === "darwin") {
      window.setAlwaysOnTop(true, "normal", -1);
      window.once("focus", () => {
        window.setAlwaysOnTop(false);
      });
    }
    window.showInactive();
  } else if (is.dev) {
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

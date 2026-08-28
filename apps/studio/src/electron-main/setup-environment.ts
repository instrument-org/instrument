import { is, platform } from "@electron-toolkit/utils";
import { APP_NAME } from "@instrument-org/shared";
import { applyCommandLineToolsEnv } from "@instrument-org/workspace/electron";
import { app } from "electron";
import fixPath from "fix-path";
import path from "node:path";

import { initializeElectronLogging, logger } from "./lib/electron-logger";
import { setupDBusEnvironment } from "./lib/setup-dbus-env";

/**
 * Configures the Electron app's userData directory.
 * This MUST be called before any other Electron APIs that depend on userData.
 * Especially electron-store, which runs in the module scope.
 */
function configureUserDataDirectory() {
  if (process.env.ELECTRON_USER_DATA_DIR) {
    // eslint-disable-next-line no-console
    console.log(
      `Using custom user data dir: ${process.env.ELECTRON_USER_DATA_DIR}`,
    );
    app.setPath("userData", process.env.ELECTRON_USER_DATA_DIR);
    return;
  }

  if (process.env.ELECTRON_USE_NEW_USER_FOLDER === "true") {
    const folderName = `${APP_NAME} (${Date.now().toString()})`;
    const newDir = path.join(app.getPath("userData"), "..", folderName);
    // eslint-disable-next-line no-console
    console.log(`Using new user folder: ${newDir}`);
    app.setPath("userData", newDir);
    app.setName(folderName);
    return;
  }

  if (is.dev) {
    let suffix = "";
    if (process.env.ELECTRON_DEV_USER_FOLDER_SUFFIX) {
      suffix = ` (${process.env.ELECTRON_DEV_USER_FOLDER_SUFFIX})`;
    }
    const DEV_APP_NAME = `${APP_NAME} (Dev${suffix})`;
    if (suffix) {
      // eslint-disable-next-line no-console
      console.log(`Using user folder ${DEV_APP_NAME}`);
    }
    // Must be done as soon as possible because it's stateful
    app.setPath(
      "userData",
      path.join(app.getPath("userData"), "..", DEV_APP_NAME),
    );
    app.setName(DEV_APP_NAME);
  }
}

configureUserDataDirectory();

initializeElectronLogging();

// Suppress Unstorage dB0 experimental warning
// Remove when stable https://github.com/unjs/unstorage/blob/main/src/drivers/db0.ts
(
  globalThis as unknown as Record<string, boolean>
).__unstorage_db0_experimental_warning__ = true;

const OZONE_PLATFORMS = ["auto", "wayland", "x11"] as const;

/**
 * Which display protocol Electron talks on Linux.
 *
 * `x11` by default, so a Wayland desktop runs the app through XWayland. That is
 * a workaround for Wayland problems Electron has not finished with, and it has
 * its own price: a drag out of the app never reaches a native Wayland client,
 * because Chromium's browser-process-initiated drag does not cross the bridge a
 * GTK app's does (see docs/findings/drag-out-does-not-cross-xwayland.md).
 *
 * `auto` is Electron's own default since 38, and means native Wayland in a
 * Wayland session. Answering whether it fixes the drag, and what it costs in
 * window positioning and programmatic focus, needs a build that can be asked
 * for it -- which is what this variable is for. Passing `--ozone-platform` on
 * the command line does not work, because the switch set here is applied after
 * the process command line is parsed and overwrites it.
 */
function resolveOzonePlatform() {
  const requested = process.env.INSTRUMENT_OZONE_PLATFORM;
  if (!requested) {
    return "x11";
  }

  const match = OZONE_PLATFORMS.find((value) => value === requested);
  if (!match) {
    logger.warn(
      `Ignoring INSTRUMENT_OZONE_PLATFORM=${requested}; expected one of ${OZONE_PLATFORMS.join(", ")}`,
    );
    return "x11";
  }

  logger.info(`Using ozone platform: ${match}`);
  return match;
}

const passwordStore = setupDBusEnvironment();

if (platform.isLinux) {
  app.commandLine.appendSwitch("ozone-platform", resolveOzonePlatform());

  // Allow CDP Input.dispatchMouseEvent on occluded web contents (e.g.
  // agent-browser webview guests parked offscreen in the paint host).
  // Without this, Chromium's WidgetInputHandlerManager suppresses input on
  // views that have not yet produced a compositor frame in the visible
  // window, causing click commands to time out on Linux where occlusion
  // tracking is stricter than macOS.
  // https://github.com/electron/electron/issues/35155
  app.commandLine.appendSwitch("allow-pre-commit-input");

  const existing = app.commandLine.getSwitchValue("password-store");
  if (existing) {
    logger.info(
      `Command line already has password-store: ${existing} - not overriding`,
    );
  } else if (passwordStore) {
    app.commandLine.appendSwitch("password-store", passwordStore);
    logger.info(`Using password store: ${passwordStore}`);
  }
}

if (!platform.isWindows) {
  // Fix the $PATH on macOS and Linux when run from a GUI app
  fixPath();
}

// After fixPath, so the probe runs against the PATH everything else will see.
// Set on this process rather than per-spawn so every descendant inherits it,
// including the ones that build their own environment from scratch.
applyCommandLineToolsEnv();

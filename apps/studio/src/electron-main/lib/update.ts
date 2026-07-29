import {
  createAppUpdater,
  type UpdaterPort,
} from "@/electron-main/lib/create-app-updater";
import { logger } from "@/electron-main/lib/electron-logger";
import { publisher } from "@/electron-main/rpc/publisher";
import {
  APP_UPDATER_CACHE_DIR_NAME,
  RELEASES_BUCKET_URL,
} from "@instrument-org/shared";
import { app } from "electron";
import pkg from "electron-updater";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";

import { getPreferencesStore, setLastUpdateCheck } from "../stores/preferences";

// Returns false to abort the install when the user cancels the running-agents
// warning.
type ConfirmQuit = () => Promise<boolean>;

// Required due to https://github.com/electron-userland/electron-builder/issues/7976
const { autoUpdater } = pkg;
const scopedLogger = logger.scope("appUpdater");

const IS_MACOS_INTEL = os.platform() === "darwin" && os.arch() === "x64";
// macOS on Intel is the only custom channel, otherwise use the defaults.
const MACOS_INTEL_CHANNEL = "latest-x64";

export function createStudioAppUpdater({
  confirmQuit,
}: { confirmQuit?: ConfirmQuit } = {}) {
  autoUpdater.logger = logger.scope("appUpdater:autoUpdater");
  autoUpdater.autoDownload = true;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.forceDevUpdateConfig =
    process.env.FORCE_DEV_AUTO_UPDATE === "true";

  const port: UpdaterPort = {
    checkForUpdates: () => autoUpdater.checkForUpdates(),
    configureFeed: () => {
      autoUpdater.setFeedURL({
        channel: getChannel(),
        provider: "generic",
        updaterCacheDirName: APP_UPDATER_CACHE_DIR_NAME,
        url: RELEASES_BUCKET_URL,
      });
    },
    install: installStagedUpdate,
    isActive: () => autoUpdater.isUpdaterActive(),
    subscribe: (handlers) => {
      autoUpdater.on("download-progress", handlers.progress);
      autoUpdater.on("error", handlers.failed);
      autoUpdater.on("update-available", handlers.available);
      autoUpdater.on("update-cancelled", handlers.canceled);
      autoUpdater.on("update-downloaded", handlers.downloaded);
      autoUpdater.on("update-not-available", handlers.notAvailable);
    },
  };

  const updater = createAppUpdater({
    confirmQuit,
    getCurrentVersion: () => app.getVersion(),
    installNotice: getInstallNotice(),
    log: scopedLogger,
    publish: (status) => {
      publisher.publish("updates.status", { status });
    },
    recordCheck: setLastUpdateCheck,
    updater: port,
  });

  publisher.subscribe("updates.trigger-check", () => {
    void updater.checkForUpdates({ notify: true });
  });

  return updater;
}

function getChannel() {
  // beta and alpha channels are not supported on macOS x64/intel due to lack of support
  // from electron-builder.
  // https://github.com/electron-userland/electron-builder/issues/5592
  if (IS_MACOS_INTEL) {
    return MACOS_INTEL_CHANNEL;
  }

  const preferencesStore = getPreferencesStore();
  // Release channels are used internally for testing and must be set on the preferences
  // store manually.
  const channel = preferencesStore.get("releaseChannel");
  if (!channel || channel === "latest") {
    // Use defaults
    return;
  }

  return channel;
}

// Only Linux takes long enough, and involves enough OS noise, to need narrating.
function getInstallNotice() {
  if (os.platform() !== "linux") {
    return;
  }
  return isUbuntu()
    ? 'Update is installing and may take a few minutes to complete. Please ignore any "Force quit" dialogs. The app will restart when complete.'
    : "Update is installing. Please allow a few minutes for the update to complete. The app will restart when complete.";
}

function installStagedUpdate() {
  if (os.platform() === "linux") {
    // cspell:ignore PRIVS pkexec
    // Linux avoids autoUpdater.quitAndInstall(), which hangs here, and cannot use
    // app.relaunch(): that sets PR_SET_NO_NEW_PRIVS=1 on the child process,
    // permanently stripping the pkexec/sudo privileges future updates need to
    // authenticate. Spawn a detached process that waits for us to exit before
    // launching, bypassing the zygote inheritance.
    // See: https://github.com/electron/electron/issues/41463
    const child = spawn(
      "sh",
      [
        "-c",
        `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.1; done; ${process.execPath} ${process.argv
          .slice(1)
          .map((a) => JSON.stringify(a))
          .join(" ")} & disown`,
      ],
      { detached: true, stdio: "ignore" },
    );
    child.unref();
    // The staged build is applied by electron-updater's own quit handler.
    app.quit();
    return;
  }

  autoUpdater.quitAndInstall();
}

function isUbuntu(): boolean {
  if (os.platform() !== "linux") {
    return false;
  }

  try {
    const osRelease = fs.readFileSync("/etc/os-release", "utf8");
    return osRelease.includes("Ubuntu");
  } catch {
    return false;
  }
}

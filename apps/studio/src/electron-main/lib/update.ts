import {
  createAppUpdater,
  type UpdaterPort,
} from "@/electron-main/lib/create-app-updater";
import { logger } from "@/electron-main/lib/electron-logger";
import { publisher } from "@/electron-main/rpc/publisher";
import {
  APP_NAME_SLUG,
  APP_UPDATER_CACHE_DIR_NAME,
  RELEASES_BUCKET_URL,
} from "@instrument-org/shared";
import { app } from "electron";
import pkg from "electron-updater";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

// Where the artifact for the staged update landed, recorded when the download
// finishes. Only the Linux install reads it, which drives dpkg itself.
let stagedInstallerPath: string | undefined;

export function createStudioAppUpdater({
  confirmQuit,
}: { confirmQuit?: ConfirmQuit } = {}) {
  autoUpdater.logger = createAutoUpdaterLogger();
  autoUpdater.autoDownload = true;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.forceDevUpdateConfig =
    process.env.FORCE_DEV_AUTO_UPDATE === "true";

  // The version and channel every later feed line in the log reads against.
  scopedLogger.info(
    `Running ${app.getVersion()} on the ${getChannel() ?? "latest"} channel`,
  );

  const port: UpdaterPort = {
    checkForUpdates: async ({ download }) => {
      // electron-updater reads `autoDownload` synchronously while the check
      // runs, so setting it around the call is enough to scope it to this check.
      autoUpdater.autoDownload = download;
      try {
        return await autoUpdater.checkForUpdates();
      } finally {
        autoUpdater.autoDownload = true;
      }
    },
    configureFeed: () => {
      autoUpdater.setFeedURL({
        channel: getChannel(),
        provider: "generic",
        updaterCacheDirName: APP_UPDATER_CACHE_DIR_NAME,
        url: RELEASES_BUCKET_URL,
      });
    },
    downloadUpdate: () => autoUpdater.downloadUpdate(),
    install: installStagedUpdate,
    isActive: () => autoUpdater.isUpdaterActive(),
    subscribe: (handlers) => {
      autoUpdater.on("download-progress", handlers.progress);
      autoUpdater.on("error", handlers.failed);
      autoUpdater.on("update-available", handlers.available);
      autoUpdater.on("update-cancelled", handlers.canceled);
      autoUpdater.on("update-downloaded", (event) => {
        // Where the artifact landed, which the Linux install below hands to a
        // process of its own. Taken from the event rather than rebuilt from the
        // cache-directory name, which the app and the build it is updating from
        // do not always agree on.
        stagedInstallerPath = event.downloadedFile;
        handlers.downloaded(event);
      });
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

// The debug lines worth keeping: the proxy-server lifecycle and, on macOS, the
// event that says Squirrel finished staging the build. Matched by subject rather
// than exact text so a reworded upstream message still lands.
const SQUIRREL_HANDOFF_LOG = /nativeUpdater|proxy server/i;

// electron-updater logs the handoff above at debug level, which the production
// file transport drops, and those are the only lines separating an install that
// could not take from one that never ran. Route them to info and keep a failed
// update diagnosable from a user's log alone.
//
// Only them. The differential downloader logs at debug too, and one of its
// messages is the entire block plan as formatted JSON: 1400+ lines per download,
// which would bury the signal this exists to surface.
function createAutoUpdaterLogger() {
  const autoUpdaterLogger = logger.scope("appUpdater:autoUpdater");
  return {
    debug: (message: string) => {
      if (SQUIRREL_HANDOFF_LOG.test(message)) {
        autoUpdaterLogger.info(message);
      }
    },
    error: (message?: unknown) => {
      autoUpdaterLogger.error(message);
    },
    info: (message?: unknown) => {
      autoUpdaterLogger.info(message);
    },
    warn: (message?: unknown) => {
      autoUpdaterLogger.warn(message);
    },
  };
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
  if (os.platform() !== "linux") {
    autoUpdater.quitAndInstall();
    return;
  }

  // Linux drives its own install. Two constraints shape it.
  //
  // `app.relaunch()` is unusable: it sets PR_SET_NO_NEW_PRIVS=1 on the child,
  // permanently stripping the pkexec privileges later updates authenticate with
  // (https://github.com/electron/electron/issues/41463, closed as not planned).
  //
  // And electron-updater must not install from its own quit handler, which runs
  // dpkg synchronously on this thread as a child of this process. That puts the
  // transaction in the app's cgroup, so anything ending the app severs it with
  // the package unpacked and its AppArmor profile removed, leaving an
  // installation that will not start at all, and takes the `apt-get install -f`
  // recovery down with the process that would have run it.
  // See docs/findings/deb-update-left-the-package-unconfigured.md.
  if (!stagedInstallerPath) {
    scopedLogger.warn(
      "No staged installer path recorded; leaving the install to electron-updater",
    );
    autoUpdater.quitAndInstall();
    return;
  }

  try {
    startDetachedInstall(stagedInstallerPath);
  } catch (error) {
    scopedLogger.error(
      new Error("Could not hand off the Linux install", { cause: error }),
    );
    autoUpdater.quitAndInstall();
    return;
  }

  // The handoff owns the install now, so the quit handler must not run a second.
  autoUpdater.autoInstallOnAppQuit = false;
  app.quit();
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

// Single-quote for /bin/sh, which has no escape inside single quotes: close the
// quote, emit an escaped one, reopen.
function quoteForShell(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Write and start the script that installs the staged package.
 *
 * It re-runs itself inside a transient systemd scope, which is what takes it out
 * of this app's cgroup. `detached` alone is not enough: that is `setsid`, which
 * makes a new session and not a new cgroup, and systemd tears a session down
 * along with the cgroup holding it. A host without systemd falls through to a
 * plain detached process, which still outlives an ordinary exit.
 */
function startDetachedInstall(installerPath: string) {
  const relaunch = [process.execPath, ...process.argv.slice(1)]
    .map(quoteForShell)
    .join(" ");
  // `dpkg -i` can stop short of configuring the package. Chaining the repair
  // into the same shell is what lets a partial transaction finish, rather than
  // depending on a catch in a process that may be gone by then.
  const install = `dpkg -i ${quoteForShell(installerPath)} || apt-get install -f -y`;
  const processName = path.basename(process.execPath);

  const script = `#!/bin/sh
if [ "$1" != "--scoped" ] && command -v systemd-run >/dev/null 2>&1; then
  systemd-run --user --scope --collect --quiet -- "$0" --scoped && exit 0
fi

# dpkg must not rewrite the installation underneath a running app.
while kill -0 ${process.pid} 2>/dev/null; do sleep 0.1; done

if command -v pkexec >/dev/null 2>&1; then
  pkexec --disable-internal-agent sh -c ${quoteForShell(install)}
else
  sudo -n sh -c ${quoteForShell(install)}
fi

# Relaunch only if nothing came back on its own while the install ran. Starting a
# second copy over a just-replaced installation is how the same handoff goes
# wrong on macOS (electron/electron#36130).
pgrep -x ${quoteForShell(processName)} >/dev/null 2>&1 || setsid ${relaunch} >/dev/null 2>&1 &

rm -f "$0"
`;

  const scriptPath = path.join(
    os.tmpdir(),
    `${APP_NAME_SLUG}-install-${process.pid}.sh`,
  );
  fs.writeFileSync(scriptPath, script, { mode: 0o700 });
  spawn("sh", [scriptPath], { detached: true, stdio: "ignore" }).unref();
  scopedLogger.info(`Handed the staged install to ${scriptPath}`);
}

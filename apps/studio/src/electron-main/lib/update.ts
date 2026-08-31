import {
  createAppUpdater,
  type UpdaterPort,
} from "@/electron-main/lib/create-app-updater";
import { logger } from "@/electron-main/lib/electron-logger";
import { publisher } from "@/electron-main/rpc/publisher";
import {
  APP_NAME,
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
// finishes. Only the Debian install reads it, which drives dpkg itself.
let stagedInstallerPath: string | undefined;

export function createStudioAppUpdater({
  confirmQuit,
}: { confirmQuit?: ConfirmQuit } = {}) {
  autoUpdater.logger = createAutoUpdaterLogger();
  autoUpdater.autoDownload = true;
  autoUpdater.disableWebInstaller = true;
  // The Debian package installs through startDetachedInstall and nowhere else.
  // Left at its default, electron-updater also installs from its own quit
  // handler, which runs dpkg inline in the exiting process: an ordinary quit
  // with an update already staged would take the very path the handoff exists
  // to avoid. Every other package keeps the default, so quitting hands the
  // staged artifact to the installer electron-updater has for that format.
  autoUpdater.autoInstallOnAppQuit = !installedFromDeb();
  autoUpdater.forceDevUpdateConfig =
    process.env.FORCE_DEV_AUTO_UPDATE === "true";

  // The version and channel every later feed line in the log reads against.
  scopedLogger.info(
    `Running ${app.getVersion()} on the ${getChannel() ?? "latest"} channel`,
  );
  reportPreviousInstall();

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

/**
 * Whether a build is the Debian package, from the marker electron-builder left
 * in its resources directory.
 *
 * That file holds `deb`, `rpm` or `pacman`, and an AppImage build has none at
 * all. electron-updater reads the same marker to choose between its DebUpdater,
 * RpmUpdater, PacmanUpdater and AppImageUpdater, so deciding from it keeps the
 * dpkg handoff and the installer that runs when the handoff is declined in
 * agreement about which package is being replaced.
 */
export function isDebInstall({
  packageType,
  platform,
}: {
  packageType: string | undefined;
  platform: NodeJS.Platform;
}) {
  return platform === "linux" && packageType?.trim() === "deb";
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

function getInstallLogPath() {
  return path.join(app.getPath("userData"), "last-update-install.log");
}

// Only the Debian install needs narrating: it is the one that closes the app,
// asks the user for authentication, and comes back by itself. Declining that
// prompt is the one way an update quietly does not happen, which is what this
// says.
function getInstallNotice() {
  if (!installedFromDeb()) {
    return;
  }
  return `${APP_NAME} will close and ask you to authenticate, then reopen once the update is installed.`;
}

function installedFromDeb() {
  return isDebInstall({
    packageType: readPackageType(),
    platform: os.platform(),
  });
}

function installStagedUpdate() {
  if (!installedFromDeb()) {
    autoUpdater.quitAndInstall();
    return;
  }

  // The Debian package drives its own install. Two constraints shape it.
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

  app.quit();
}

// Single-quote for /bin/sh, which has no escape inside single quotes: close the
// quote, emit an escaped one, reopen.
function quoteForShell(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

// Missing on any build electron-builder wrote no marker for, and unreadable
// outside a packaged app, both of which answer the question the same way.
function readPackageType() {
  try {
    return fs.readFileSync(
      path.join(process.resourcesPath, "package-type"),
      "utf8",
    );
  } catch {
    return;
  }
}

/**
 * Log what the previous install did, if there was one.
 *
 * A Linux install finishes after the process that started it has exited, so
 * nothing it does can reach the log of the session that asked for it. Reading
 * the file on the next start is the only account of the outcome there is, and it
 * is removed once read so a later boot does not report the same install twice.
 */
function reportPreviousInstall() {
  if (os.platform() !== "linux" || !fs.existsSync(getInstallLogPath())) {
    return;
  }

  try {
    // Bounded because it carries dpkg's output, which has no size contract.
    const contents = fs
      .readFileSync(getInstallLogPath(), "utf8")
      .trim()
      .slice(-8000);
    fs.rmSync(getInstallLogPath(), { force: true });
    if (contents) {
      scopedLogger.info(`Previous update install:\n${contents}`);
    }
  } catch (error) {
    scopedLogger.warn(
      new Error("Could not read the previous install log", { cause: error }),
    );
  }
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

  const logPath = getInstallLogPath();

  // Everything below runs after this process is gone, so this file is the only
  // account of it there will ever be. Both the outer run and the scoped re-exec
  // append, which is what makes the handoff itself visible.
  const script = `#!/bin/sh
exec >>${quoteForShell(logPath)} 2>&1
echo "=== $(date -Is) install starting, args: $*"

if [ "$1" != "--scoped" ] && command -v systemd-run >/dev/null 2>&1; then
  systemd-run --user --scope --collect --quiet -- "$0" --scoped && exit 0
  echo "systemd-run did not take, continuing in this process"
fi

# dpkg must not rewrite the installation underneath a running app.
echo "waiting for pid ${process.pid} to exit"
while kill -0 ${process.pid} 2>/dev/null; do sleep 0.1; done

if command -v pkexec >/dev/null 2>&1; then
  pkexec --disable-internal-agent sh -c ${quoteForShell(install)}
else
  sudo -n sh -c ${quoteForShell(install)}
fi
status=$?
echo "install exited $status"

# Relaunch only if nothing came back on its own while the install ran. Starting a
# second copy over a just-replaced installation is how the same handoff goes
# wrong on macOS (electron/electron#36130).
if pgrep -x ${quoteForShell(processName)} >/dev/null 2>&1; then
  echo "an instance is already running, not relaunching"
else
  echo "relaunching"
  setsid ${relaunch} >/dev/null 2>&1 &
fi

echo "=== $(date -Is) finished"
rm -f "$0"
`;

  // One install per file, so what the next start reads is this install rather
  // than an older one it never got to report.
  fs.rmSync(logPath, { force: true });

  // Beside the log rather than in the temp directory. What this file holds is
  // the command line `pkexec` will run as root, and the user is at that moment
  // expecting an authentication prompt from an update, so whoever can write the
  // file chooses what they authenticate. A shared `/tmp` and a name with one
  // guessable variable in it is enough for another local account to get there
  // first -- `writeFileSync` opens without `O_EXCL` and follows a symlink, and
  // its `mode` only applies to a file it creates. `userData` is inside the
  // user's own home and no other account can create anything in it.
  const scriptPath = path.join(
    app.getPath("userData"),
    `${APP_NAME_SLUG}-install-${process.pid}.sh`,
  );
  // Exclusive, so a leftover from a previous run with this pid is replaced
  // deliberately above rather than written through, and the private mode lands
  // on a file this call is known to have created.
  fs.rmSync(scriptPath, { force: true });
  fs.writeFileSync(scriptPath, script, { flag: "wx", mode: 0o700 });
  spawn("sh", [scriptPath], { detached: true, stdio: "ignore" }).unref();
  scopedLogger.info(
    `Handed the staged install to ${scriptPath}, logging to ${logPath}`,
  );
}

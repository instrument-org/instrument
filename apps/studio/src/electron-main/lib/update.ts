import {
  createAppUpdater,
  StagedUpdateRejectedError,
  type UpdaterPort,
} from "@/electron-main/lib/create-app-updater";
import { logger } from "@/electron-main/lib/electron-logger";
import { publisher } from "@/electron-main/rpc/publisher";
import {
  APP_NAME,
  APP_NAME_SLUG,
  APP_FLAVOR,
  APP_UPDATER_CACHE_DIR_NAME,
  RELEASES_BUCKET_URL,
} from "@instrument-org/shared";
import { app, BrowserWindow, autoUpdater as nativeUpdater } from "electron";
import pkg, { type UpdateInfo } from "electron-updater";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getMachinePreferences } from "../stores/machine/preferences";
import {
  recordInstallRequest,
  setLastUpdateCheck,
} from "../stores/machine/state";

// Returns false to abort the install when the user cancels the running-agents
// warning.
type ConfirmQuit = () => Promise<boolean>;

// Required due to https://github.com/electron-userland/electron-builder/issues/7976
const { autoUpdater } = pkg;
const scopedLogger = logger.scope("appUpdater");

const IS_MACOS_INTEL = os.platform() === "darwin" && os.arch() === "x64";
// macOS on Intel is the only custom channel, otherwise use the defaults.
const MACOS_INTEL_CHANNEL = "latest-x64";

// The staged update, recorded when the download finishes: where its artifact
// landed, and what the feed published for it this session. On Linux the
// artifact is checked against that right before it is installed; the Debian
// install also hands it to dpkg itself.
let staged: undefined | { file: string; info: UpdateInfo };

// macOS only: the download electron-updater has finished and handed to
// Squirrel.Mac, which Squirrel has not staged yet. electron-updater's
// `update-downloaded` means the zip is in its cache; Squirrel then fetches it
// again through a local proxy and unpacks it, and starting that fetch deletes
// the build it staged before. Only Squirrel's own `update-downloaded` means
// there is a build to install, while electron-updater's flag for it stays true
// from the earlier one, so a quit in between relaunches the running version.
let awaitingSquirrel: undefined | UpdateInfo;

export function createStudioAppUpdater({
  confirmQuit,
  withdrawQuit,
}: { confirmQuit?: ConfirmQuit; withdrawQuit?: () => void } = {}) {
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
  // Registered before electron-updater adds its own, which it does once a
  // download finishes, so this runs first on the same quit.
  app.on("quit", checkBeforeInstallOnQuit);

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
    // A preview's feed would be the shipping app's, whose update replaces the
    // preview's identity with the real one, so a preview stays where it is.
    isActive: () =>
      APP_FLAVOR.kind !== "preview" && autoUpdater.isUpdaterActive(),
    subscribe: (handlers) => {
      const macOS = os.platform() === "darwin";
      let handedToSquirrel: undefined | UpdateInfo;
      autoUpdater.on("download-progress", handlers.progress);
      autoUpdater.on("error", handlers.failed);
      autoUpdater.on("update-available", handlers.available);
      autoUpdater.on("update-cancelled", handlers.canceled);
      autoUpdater.on("update-downloaded", (event) => {
        // Where the artifact landed, which the Linux install below hands to a
        // process of its own. Taken from the event rather than rebuilt from the
        // cache-directory name, which the app and the build it is updating from
        // do not always agree on.
        staged = { file: event.downloadedFile, info: event };
        if (macOS) {
          // Reported once Squirrel.Mac has it, so the updater waits out
          // Squirrel's part of the download exactly as it waits out the rest.
          awaitingSquirrel = event;
          handedToSquirrel = event;
          return;
        }
        handlers.downloaded(event);
      });
      autoUpdater.on("update-not-available", handlers.notAvailable);
      if (macOS) {
        nativeUpdater.on("update-downloaded", () => {
          const info = handedToSquirrel;
          handedToSquirrel = undefined;
          awaitingSquirrel = undefined;
          if (info) {
            handlers.downloaded(info);
          }
        });
        // electron-updater reports Squirrel's errors as its own `error`.
        nativeUpdater.on("error", () => {
          handedToSquirrel = undefined;
          awaitingSquirrel = undefined;
        });
      }
    },
  };

  const updater = createAppUpdater({
    confirmQuit,
    farewell: fadeOutBeforeInstall,
    withdrawQuit: () => {
      recordInstallRequest(null);
      restoreWindows();
      withdrawQuit?.();
    },
    getCurrentVersion: () => app.getVersion(),
    installAsksForPassword: installAsksForPassword({
      packageType: readPackageType(),
      platform: os.platform(),
    }),
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

/**
 * Whether installing an update asks for the person's password: a Linux
 * package (deb, rpm or pacman, by the same marker as `isDebInstall`), which
 * installs as root through `pkexec`. An AppImage replaces itself, and macOS
 * and Windows install without asking.
 */
export function installAsksForPassword({
  packageType,
  platform,
}: {
  packageType: string | undefined;
  platform: NodeJS.Platform;
}) {
  return (
    platform === "linux" &&
    ["deb", "pacman", "rpm"].includes(packageType?.trim() ?? "")
  );
}

// The debug lines worth keeping: the proxy-server lifecycle and, on macOS, the
// event that says Squirrel finished staging the build. Matched by subject rather
// than exact text so a reworded upstream message still lands.
const SQUIRREL_HANDOFF_LOG = /nativeUpdater|proxy server/i;

function installedFromDeb() {
  return isDebInstall({
    packageType: readPackageType(),
    platform: os.platform(),
  });
}

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

  // Release channels are used internally for testing and must be set on the
  // machine preferences store manually.
  const channel = getMachinePreferences().get("releaseChannel");
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

/**
 * The sha512 the feed published for the artifact at `file`, as electron-builder
 * writes it (base64): the entry whose URL names the file, else the one entry
 * with its extension, which is how electron-updater chose what to download.
 */
export function publishedSha512(
  info: Pick<UpdateInfo, "files">,
  file: string,
): string | undefined {
  const name = path.basename(file);
  const nameOf = (url: string) => {
    try {
      return path.posix.basename(
        decodeURIComponent(new URL(url, "https://feed.invalid/").pathname),
      );
    } catch {
      return path.posix.basename(url);
    }
  };
  const named = info.files.find((entry) => nameOf(entry.url) === name);
  if (named) {
    return named.sha512;
  }
  const extension = path.extname(name).toLowerCase();
  const sameKind = info.files.filter((entry) =>
    nameOf(entry.url).toLowerCase().endsWith(extension),
  );
  return sameKind.length === 1 ? sameKind[0]?.sha512 : undefined;
}

/**
 * Why the staged artifact is not the one the feed published, or undefined when
 * it is. Read whole each time: electron-updater hashes an artifact it finds
 * from an earlier launch, but of one it downloaded in this run it checks only
 * that the file exists, so a file replaced in the cache folder since would
 * otherwise be installed as the update.
 */
export function stagedArtifactProblem(stagedUpdate: {
  file: string;
  info: Pick<UpdateInfo, "files">;
}): string | undefined {
  const expected = publishedSha512(stagedUpdate.info, stagedUpdate.file);
  if (!expected) {
    return `the feed lists no checksum for ${path.basename(stagedUpdate.file)}`;
  }
  let actual: string;
  try {
    actual = sha512Of(stagedUpdate.file);
  } catch (error) {
    return `it could not be read: ${error instanceof Error ? error.message : String(error)}`;
  }
  return actual === expected
    ? undefined
    : `its sha512 is ${actual}, and the feed published ${expected}`;
}

// Synchronous, because the install on quit runs in a quit handler that cannot
// wait, and an explicit install is the last thing this process does.
function sha512Of(file: string) {
  const hash = createHash("sha512");
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (
      let read = fs.readSync(fd, buffer);
      read > 0;
      read = fs.readSync(fd, buffer)
    ) {
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("base64");
}

// The artifact last checked and found to be the published one, so the quit
// that follows an explicit install does not read it a second time.
let verifiedFile: string | undefined;

/**
 * Check the staged artifact on Linux, where nothing else stands between the
 * cache folder and an install that runs as root (a package) or replaces the
 * app (an AppImage). macOS and Windows check the signature of what they
 * install. One that does not match is removed, so the next check downloads it
 * again rather than finding it on disk.
 */
function rejectedStagedArtifact(): string | undefined {
  if (os.platform() !== "linux") {
    return;
  }
  if (!staged) {
    return "no staged update was recorded";
  }
  const problem = stagedArtifactProblem(staged);
  if (problem === undefined) {
    verifiedFile = staged.file;
    return;
  }
  scopedLogger.error(
    new Error(`Refusing to install ${staged.file}: ${problem}`),
  );
  try {
    fs.rmSync(staged.file, { force: true });
  } catch (error) {
    scopedLogger.warn(
      new Error("Could not remove the rejected update", { cause: error }),
    );
  }
  staged = undefined;
  verifiedFile = undefined;
  return problem;
}

/**
 * The install electron-updater runs from its own quit handler (every Linux
 * package but the Debian one) is checked here first, and turned off for this
 * quit when the artifact is not the published one.
 */
function checkBeforeInstallOnQuit() {
  if (
    !autoUpdater.autoInstallOnAppQuit ||
    !staged ||
    staged.file === verifiedFile
  ) {
    return;
  }
  if (rejectedStagedArtifact() !== undefined) {
    autoUpdater.autoInstallOnAppQuit = false;
  }
}

/**
 * Leave a staged update for a later quit rather than this one. The update is
 * found in the cache folder again on the next launch and staged as before.
 */
export function deferInstallOnQuit() {
  autoUpdater.autoInstallOnAppQuit = false;
}

// How long "Restarting" shows before the windows fade, so a click reads as
// taken, and how long the fade takes.
const RESTART_HOLD_MS = 700;
const FADE_MS = 200;
const FADE_STEPS = 10;
// Brings the windows back should the quit not come, so a stalled install
// never leaves the app running unseen.
const FADE_RESTORE_MS = 10_000;

async function fadeOutBeforeInstall() {
  await sleep(RESTART_HOLD_MS);
  // Linux has no window opacity, so its windows go when the app does.
  if (os.platform() === "linux") {
    return;
  }
  for (let step = 1; step <= FADE_STEPS; step++) {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.setOpacity(1 - step / FADE_STEPS);
      }
    }
    await sleep(FADE_MS / FADE_STEPS);
  }
  setTimeout(restoreWindows, FADE_RESTORE_MS).unref();
}

function restoreWindows() {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.setOpacity(1);
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function installStagedUpdate() {
  if (rejectedStagedArtifact() !== undefined) {
    throw new StagedUpdateRejectedError(
      `The update ${APP_NAME} downloaded doesn't match the one that was published, so it wasn't installed. Check for updates to download it again.`,
    );
  }
  // Unreachable while the updater reports a download only once Squirrel.Mac
  // has staged it, and kept so a path that hands Squirrel a build without
  // clearing what was staged fails loudly rather than relaunching this version.
  if (awaitingSquirrel) {
    throw new Error(
      `${APP_NAME} is still getting the update ready. Try again in a moment.`,
    );
  }
  if (staged) {
    recordInstallRequest(staged.info.version);
  }
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
  if (!staged) {
    scopedLogger.warn(
      "No staged installer path recorded; leaving the install to electron-updater",
    );
    autoUpdater.quitAndInstall();
    return;
  }

  try {
    startDetachedInstall(staged.file);
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

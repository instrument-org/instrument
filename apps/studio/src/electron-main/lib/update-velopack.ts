// The Windows updater: Velopack's UpdateManager behind the same `UpdaterPort`
// electron-updater fills on macOS and Linux, so the install flow, the
// automatic restart and the update UI run unchanged over it.
import { APP_NAME, WINDOWS_PUBLISHER_NAMES } from "@instrument-org/shared";
import { app, net } from "electron";
import type {
  ProgressInfo,
  UpdateCheckResult,
  UpdateInfo,
} from "electron-updater";
import fs from "node:fs";
import path from "node:path";
import type * as Velopack from "velopack";

import {
  StagedUpdateRejectedError,
  type UpdaterEvents,
  type UpdaterPort,
} from "./create-app-updater";
import {
  judgeUpdatePackage,
  readSignatures,
  unpackPackageExecutables,
} from "./update-signature";
import { loadVelopack } from "./velopack";

type Logger = {
  error: (message: string, ...args: unknown[]) => void;
  info: (message: string) => void;
  warn: (message: string, ...args: unknown[]) => void;
};

// A downloaded package whose executables were found to be ours, and what it
// was on disk when they were: an install of anything else is refused.
type Verified = {
  file: string;
  mtimeMs: number;
  size: number;
  update: Velopack.UpdateInfo;
};

/**
 * Why an update was refused before it was applied. Reported through the
 * updater's `failed`, so the person reads it where any failed update shows.
 */
export class UnsignedUpdateError extends Error {
  override name = "UnsignedUpdateError";
}

function toUpdateInfo(update: Velopack.UpdateInfo): UpdateInfo {
  const target = update.TargetFullRelease;
  return {
    files: [{ sha512: "", size: target.Size, url: target.FileName }],
    path: target.FileName,
    releaseDate: "",
    releaseNotes: target.NotesMarkdown || null,
    sha512: "",
    version: target.Version,
  };
}

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Checks that every executable in a downloaded package (the app, its
 * libraries and native modules, Velopack's own updater) is validly signed by
 * Instrument's publisher. Throws `UnsignedUpdateError` naming what failed.
 */
export async function verifyPackageSignatures(
  packageFile: string,
  {
    adoptUpdater,
    exeName,
    log,
  }: {
    // Given the package's own updater once everything checked out.
    adoptUpdater?: (updater: string) => void;
    exeName: string;
    log: Logger;
  },
) {
  const started = Date.now();
  const unpacked = await unpackPackageExecutables(packageFile);
  try {
    const reports = await readSignatures(unpacked.folder);
    const verdict = judgeUpdatePackage({
      mainExe: exeName,
      publisherNames: WINDOWS_PUBLISHER_NAMES,
      reports,
    });
    if (!verdict.ok) {
      log.error(
        `Refusing ${path.basename(packageFile)}: ${verdict.problems.join("; ")}`,
      );
      throw new UnsignedUpdateError(
        `The update ${APP_NAME} downloaded isn't signed by its publisher, so it wasn't installed.`,
      );
    }
    log.info(
      `Checked the signatures of ${verdict.checked} executables in ${path.basename(packageFile)} in ${Date.now() - started} ms`,
    );
    adoptUpdater?.(path.join(unpacked.folder, "Squirrel.exe"));
  } finally {
    unpacked.dispose();
  }
}

// Where a feed file is: under a URL, or on a test host, in a folder.
export function joinFeed(feed: string, name: string) {
  return /^https?:\/\//i.test(feed)
    ? `${feed.replace(/\/+$/, "")}/${encodeURIComponent(name)}`
    : path.join(feed, name);
}

/**
 * Whether the feed has this file. A channel no release has been published
 * to has no `releases.<channel>.json`, which is no update rather than a
 * failed check.
 */
export async function hasFeedFile(feed: string, name: string) {
  const location = joinFeed(feed, name);
  if (!/^https?:\/\//i.test(location)) {
    return fs.existsSync(location);
  }
  const response = await net.fetch(location, {
    cache: "no-store",
    method: "HEAD",
  });
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new Error(`${name}: ${response.status} ${response.statusText}`);
  }
  return true;
}

export function createVelopackPort({
  feed,
  getChannel,
  isActive,
  log,
  onInstall,
  root,
  verify = verifyPackageSignatures,
}: {
  // The feed: the bucket's `velopack/`, or a test build's folder or URL.
  feed: string;
  // The release channel to read, `latest` when none is chosen.
  getChannel: () => string;
  isActive: () => boolean;
  log: Logger;
  // Right before the app quits to install `version`.
  onInstall: (options: { automatic: boolean; version: string }) => void;
  // Where Velopack installed the app (`velopackRoot()`).
  root: string;
  verify?: typeof verifyPackageSignatures;
}): UpdaterPort {
  const velopack = loadVelopack();
  const exeName = path.basename(process.execPath);
  const packagesDir = path.join(root, "packages");
  let manager: undefined | Velopack.UpdateManager;
  let handlers: undefined | UpdaterEvents;
  // What the last check found, for a download started after it.
  let found: undefined | Velopack.UpdateInfo;
  let download: undefined | { promise: Promise<string[]>; version: string };
  let verified: undefined | Verified;
  // Set by an install, which quits to apply it and start the new version.
  let installing: undefined | Verified;

  const current = (): UpdateInfo => ({
    files: [],
    path: "",
    releaseDate: "",
    sha512: "",
    version: app.getVersion(),
  });

  const startDownload = (update: Velopack.UpdateInfo) => {
    const version = update.TargetFullRelease.Version;
    if (download?.version === version) {
      return download.promise;
    }
    const total =
      update.DeltasToTarget.length > 0
        ? update.DeltasToTarget.reduce((sum, delta) => sum + delta.Size, 0)
        : update.TargetFullRelease.Size;
    const promise = (async () => {
      const started = Date.now();
      // Velopack's download puts the package's own updater in place of
      // Update.exe as soon as the package is on disk, before anything has
      // checked it, and the launcher stub runs Update.exe at every start. So
      // the one there now is kept aside and put back the moment the download
      // returns; the new one goes in only once the package checks out.
      const updateExe = path.join(root, "Update.exe");
      const keptUpdater = path.join(packagesDir, "Update.exe.checked");
      fs.mkdirSync(packagesDir, { recursive: true });
      fs.copyFileSync(updateExe, keptUpdater);
      try {
        await managerOrThrow().downloadUpdateAsync(update, (percent) => {
          handlers?.progress({
            bytesPerSecond: 0,
            delta: 0,
            percent,
            total,
            transferred: Math.round((total * percent) / 100),
          } satisfies ProgressInfo);
        });
      } finally {
        fs.copyFileSync(keptUpdater, updateExe);
      }
      const file = path.join(packagesDir, update.TargetFullRelease.FileName);
      log.info(
        `Downloaded ${version} (${update.DeltasToTarget.length} deltas) in ${Date.now() - started} ms`,
      );
      try {
        await verify(file, {
          adoptUpdater: (updater) => {
            fs.copyFileSync(updater, updateExe);
            fs.copyFileSync(updater, keptUpdater);
          },
          exeName,
          log,
        });
      } catch (error) {
        // Gone, so neither this process nor Velopack applies it, and the
        // next check downloads it again.
        fs.rmSync(file, { force: true });
        throw error;
      }
      const stat = fs.statSync(file);
      verified = { file, mtimeMs: stat.mtimeMs, size: stat.size, update };
      handlers?.downloaded(toUpdateInfo(update));
      return [file];
    })();
    download = { promise, version };
    promise
      .catch((error: unknown) => {
        handlers?.failed(asError(error));
      })
      .finally(() => {
        if (download?.promise === promise) {
          download = undefined;
        }
      });
    return promise;
  };

  const managerOrThrow = () => {
    if (!manager) {
      throw new Error("The update feed is not configured");
    }
    return manager;
  };

  // Velopack applies an update only once this process has exited, which is
  // what electron-updater does on Windows too: an install the person or the
  // automatic restart asked for relaunches, and an ordinary quit with a
  // checked update waiting installs it quietly and starts nothing.
  app.on("quit", () => {
    const apply = installing ?? verified;
    if (!apply || !manager || !isUnchanged(apply)) {
      return;
    }
    try {
      manager.waitExitThenApplyUpdate(
        apply.update,
        true,
        installing !== undefined,
      );
    } catch (error) {
      log.error("Could not start the update on quit:", error);
    }
  });

  return {
    checkForUpdates: async ({ download: shouldDownload }) => {
      let update: null | Velopack.UpdateInfo = null;
      try {
        if (await hasFeedFile(feed, `releases.${getChannel()}.json`)) {
          update = await managerOrThrow().checkForUpdatesAsync();
        }
      } catch (error) {
        handlers?.failed(asError(error));
        throw error;
      }
      if (!update) {
        const info = current();
        handlers?.notAvailable(info);
        return {
          isUpdateAvailable: false,
          updateInfo: info,
          versionInfo: info,
        } satisfies UpdateCheckResult;
      }
      found = update;
      const info = toUpdateInfo(update);
      handlers?.available(info);
      return {
        downloadPromise: shouldDownload ? startDownload(update) : null,
        isUpdateAvailable: true,
        updateInfo: info,
        versionInfo: info,
      } satisfies UpdateCheckResult;
    },
    configureFeed: () => {
      manager = new velopack.UpdateManager(feed, {
        AllowVersionDowngrade: false,
        ExplicitChannel: getChannel(),
        MaximumDeltasBeforeFallback: 10,
      });
    },
    downloadUpdate: () =>
      found
        ? startDownload(found)
        : Promise.reject(new Error("No update was found to download")),
    install: ({ automatic }) => {
      if (!verified || !isUnchanged(verified)) {
        verified = undefined;
        throw new StagedUpdateRejectedError(
          `The update ${APP_NAME} downloaded changed after it was checked, so it wasn't installed. Check for updates to download it again.`,
        );
      }
      installing = verified;
      onInstall({
        automatic,
        version: verified.update.TargetFullRelease.Version,
      });
      app.quit();
    },
    isActive,
    subscribe: (events) => {
      handlers = events;
    },
  };
}

// The package is the one whose signatures were checked: the same size and
// the same last write. Anything that could write it otherwise can write the
// installed app as well, so this guards against an accident rather than an
// attacker, and costs nothing at quit.
function isUnchanged(entry: Verified) {
  try {
    const stat = fs.statSync(entry.file);
    return stat.size === entry.size && stat.mtimeMs === entry.mtimeMs;
  } catch {
    return false;
  }
}

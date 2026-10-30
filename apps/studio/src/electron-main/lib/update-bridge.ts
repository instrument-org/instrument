// The move from the NSIS install to Velopack, offered as an update. A build
// running from the NSIS install (every Windows install before Velopack) reads
// the Velopack feed instead of electron-updater's. What it offers is the
// channel's Velopack Setup; installing it runs that Setup, takes the NSIS copy
// out, and starts the Velopack one. Settings and data stay where they are:
// both installs keep them under the product's name in AppData.
import {
  APP_NAME,
  APP_PRODUCT_NAME,
  APP_UPDATER_CACHE_DIR_NAME,
  APP_VELOPACK_ID,
  WINDOWS_PUBLISHER_NAMES,
} from "@instrument-org/shared";
import { app, net } from "electron";
import type {
  ProgressInfo,
  UpdateCheckResult,
  UpdateInfo,
} from "electron-updater";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import semver from "semver";

import {
  StagedUpdateRejectedError,
  type UpdaterEvents,
  type UpdaterPort,
} from "./create-app-updater";
import { judgeSignatures, readSignatures } from "./update-signature";
import { hasFeedFile, joinFeed, UnsignedUpdateError } from "./update-velopack";

type Logger = {
  error: (message: string, ...args: unknown[]) => void;
  info: (message: string) => void;
  warn: (message: string, ...args: unknown[]) => void;
};

// Where the move writes what it did, for the Velopack install's first launch
// to log: the move finishes after this process is gone.
const BRIDGE_LOG_NAME = "windows-velopack-move.log";
// Written by a move that failed, so the NSIS install stops offering it for a
// while instead of downloading and running Setup again every session.
const MOVE_FAILED_NAME = "windows-velopack-move.failed";
// Long enough that a move failing every time (antivirus, a Setup that cannot
// run here) costs a download every few days rather than every session, short
// enough that one failing once (a full disk) is tried again soon.
export const MOVE_FAILURE_BACKOFF_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * When the last move failed, if that was within the backoff. An older
 * marker is removed, and the move is offered again.
 */
export function recentMoveFailure(
  userData: string,
  now = Date.now(),
): Date | undefined {
  const marker = path.join(userData, MOVE_FAILED_NAME);
  try {
    const failedAt = fs.statSync(marker, { throwIfNoEntry: false })?.mtimeMs;
    if (failedAt === undefined) {
      return;
    }
    // Either way, so a clock set back after the failure delays nothing
    // longer.
    if (Math.abs(now - failedAt) < MOVE_FAILURE_BACKOFF_MS) {
      return new Date(failedAt);
    }
    fs.rmSync(marker, { force: true });
  } catch {
    // Unreadable or locked: offer the move as if nothing had failed.
  }
  return;
}

/**
 * The NSIS install this process runs from, or undefined for any other: its
 * folder holds the uninstaller electron-builder's NSIS target writes.
 */
export function nsisInstall():
  | undefined
  | { exe: string; folder: string; uninstaller: string } {
  if (process.platform !== "win32" || !app.isPackaged) {
    return;
  }
  const folder = path.dirname(process.execPath);
  const uninstaller = path.join(folder, `Uninstall ${APP_PRODUCT_NAME}.exe`);
  return fs.existsSync(uninstaller)
    ? { exe: process.execPath, folder, uninstaller }
    : undefined;
}

type FeedAsset = { FileName: string; Type: string; Version: string };

/**
 * The newest full release in a Velopack feed's `releases.<channel>.json`, if
 * it is at least the running version: the move never takes anyone back.
 */
export function newestFullRelease(
  feed: unknown,
  runningVersion: string,
): string | undefined {
  const assets =
    typeof feed === "object" &&
    feed !== null &&
    "Assets" in feed &&
    Array.isArray(feed.Assets)
      ? (feed.Assets as unknown[])
      : [];
  let newest: string | undefined;
  for (const asset of assets) {
    if (typeof asset !== "object" || asset === null) {
      continue;
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- checked field by field below
    const { Type, Version } = asset as Partial<FeedAsset>;
    if (
      Type !== "Full" ||
      typeof Version !== "string" ||
      !semver.valid(Version)
    ) {
      continue;
    }
    if (!newest || semver.gt(Version, newest)) {
      newest = Version;
    }
  }
  return newest && semver.gte(newest, runningVersion) ? newest : undefined;
}

// A file in the feed, which is a URL or, on a test host, a folder.
async function openFeedFile(
  feed: string,
  name: string,
): Promise<{ body: Readable; size: number }> {
  const location = joinFeed(feed, name);
  if (!/^https?:\/\//i.test(location)) {
    return {
      body: fs.createReadStream(location),
      size: fs.statSync(location).size,
    };
  }
  const response = await net.fetch(location, { cache: "no-store" });
  if (!response.ok || !response.body) {
    throw new Error(`${name}: ${response.status} ${response.statusText}`);
  }
  return {
    // The DOM's ReadableStream and Node's are the same object at runtime and
    // differ only in their declared types.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
    body: Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
    size: Number(response.headers.get("content-length") ?? 0),
  };
}

async function readFeedText(feed: string, name: string) {
  const { body } = await openFeedFile(feed, name);
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createBridgePort({
  feed,
  getChannel,
  isActive,
  log,
  onInstall,
}: {
  feed: string;
  getChannel: () => string;
  isActive: () => boolean;
  log: Logger;
  onInstall: (options: { automatic: boolean; version: string }) => void;
}): UpdaterPort {
  const install = nsisInstall();
  if (!install) {
    throw new Error("Not running from an NSIS install");
  }
  const work = path.join(app.getPath("userData"), "velopack-setup");
  let handlers: undefined | UpdaterEvents;
  let found: undefined | UpdateInfo;
  let download: undefined | { promise: Promise<string[]>; version: string };
  let ready: undefined | { info: UpdateInfo; setup: string; size: number };
  let relaunch = false;
  let moving = false;
  let backoffLogged = false;

  const setupName = () => `${APP_VELOPACK_ID}-${getChannel()}-Setup.exe`;

  const infoFor = (version: string): UpdateInfo => ({
    files: [{ sha512: "", url: setupName() }],
    path: setupName(),
    releaseDate: "",
    sha512: "",
    version,
  });

  const startDownload = (info: UpdateInfo) => {
    if (download?.version === info.version) {
      return download.promise;
    }
    const promise = (async () => {
      fs.rmSync(work, { force: true, recursive: true });
      fs.mkdirSync(work, { recursive: true });
      const setup = path.join(work, setupName());
      const { body, size: total } = await openFeedFile(feed, setupName());
      let transferred = 0;
      const counted = body;
      // Reported once per whole percent: the stream's chunks are 64 KB, and
      // every report is a status the UI redraws and a line in the log.
      let reported = -1;
      counted.on("data", (chunk: Buffer) => {
        transferred += chunk.length;
        const percent = total ? Math.floor((transferred / total) * 100) : 0;
        if (percent === reported) {
          return;
        }
        reported = percent;
        handlers?.progress({
          bytesPerSecond: 0,
          delta: 0,
          percent,
          total,
          transferred,
        } satisfies ProgressInfo);
      });
      await pipeline(counted, fs.createWriteStream(setup));
      const verdict = judgeSignatures({
        publisherNames: WINDOWS_PUBLISHER_NAMES,
        reports: await readSignatures(work),
        required: [setupName()],
      });
      if (!verdict.ok) {
        fs.rmSync(work, { force: true, recursive: true });
        log.error(`Refusing ${setupName()}: ${verdict.problems.join("; ")}`);
        throw new UnsignedUpdateError(
          `The update ${APP_NAME} downloaded isn't signed by its publisher, so it wasn't installed.`,
        );
      }
      ready = { info, setup, size: fs.statSync(setup).size };
      handlers?.downloaded(info);
      return [setup];
    })();
    download = { promise, version: info.version };
    promise
      .catch((error: unknown) => {
        handlers?.failed(
          error instanceof Error ? error : new Error(String(error)),
        );
      })
      .finally(() => {
        if (download?.promise === promise) {
          download = undefined;
        }
      });
    return promise;
  };

  // Like an update, the move runs once this process has exited: an install
  // someone asked for starts the Velopack copy when it is done, and an
  // ordinary quit with the move ready makes it quietly.
  app.on("quit", () => {
    if (!ready || moving) {
      return;
    }
    moving = true;
    try {
      startMove({ install, log, relaunch, setup: ready.setup });
    } catch (error) {
      log.error("Could not start the move to Velopack:", error);
    }
  });

  return {
    checkForUpdates: async ({ download: shouldDownload }) => {
      let version: string | undefined;
      const failedAt = recentMoveFailure(app.getPath("userData"));
      if (failedAt && !backoffLogged) {
        backoffLogged = true;
        log.warn(
          `The move to Velopack failed at ${failedAt.toISOString()}; not offering it again until ${new Date(failedAt.getTime() + MOVE_FAILURE_BACKOFF_MS).toISOString()}`,
        );
      }
      try {
        const name = `releases.${getChannel()}.json`;
        if (!failedAt && (await hasFeedFile(feed, name))) {
          const text = await readFeedText(feed, name);
          version = newestFullRelease(JSON.parse(text), app.getVersion());
        }
      } catch (error) {
        handlers?.failed(
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
      if (!version) {
        const info = infoFor(app.getVersion());
        handlers?.notAvailable(info);
        return {
          isUpdateAvailable: false,
          updateInfo: info,
          versionInfo: info,
        } satisfies UpdateCheckResult;
      }
      const info = infoFor(version);
      found = info;
      handlers?.available(info);
      return {
        downloadPromise: shouldDownload ? startDownload(info) : null,
        isUpdateAvailable: true,
        updateInfo: info,
        versionInfo: info,
      } satisfies UpdateCheckResult;
    },
    configureFeed: () => {},
    downloadUpdate: () =>
      found
        ? startDownload(found)
        : Promise.reject(new Error("No update was found to download")),
    install: ({ automatic }) => {
      if (
        !ready ||
        fs.statSync(ready.setup, { throwIfNoEntry: false })?.size !== ready.size
      ) {
        ready = undefined;
        throw new StagedUpdateRejectedError(
          `The update ${APP_NAME} downloaded changed after it was checked, so it wasn't installed. Check for updates to download it again.`,
        );
      }
      relaunch = true;
      onInstall({ automatic, version: ready.info.version });
      app.quit();
    },
    isActive,
    subscribe: (events) => {
      handlers = events;
    },
  };
}

/**
 * The folders under %LOCALAPPDATA% where electron-updater kept the NSIS
 * install's downloads: the one the install's `app-update.yml` names, which
 * is where its installer left a copy of itself, and the one this build
 * points electron-updater at. Each holds an installer or two of a few hundred
 * megabytes that nothing reads once the app is Velopack's.
 */
export function updaterCacheDirs(appUpdateYml: string | undefined): string[] {
  const named = appUpdateYml
    ? /^updaterCacheDirName:[ \t]*["']?([^"'\r\n]+?)["']?[ \t]*\r?$/m.exec(
        appUpdateYml,
      )?.[1]
    : undefined;
  return [...new Set([named, APP_UPDATER_CACHE_DIR_NAME])].filter(
    (name): name is string =>
      name !== undefined && /^[\w.-]+$/.test(name) && !/^\.+$/.test(name),
  );
}

function quote(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Writes and starts the script that makes the move once this process exits:
 * the Velopack Setup, silently; then, only if it left the app installed, the
 * NSIS uninstaller, silently, with the shortcuts Setup just made kept from
 * it (NSIS removes its own by the same names); then the Velopack copy, when
 * an install asked for a relaunch. A Setup that fails leaves the NSIS install
 * as it was, and relaunches that instead.
 */
function startMove({
  install,
  log,
  relaunch,
  setup,
}: {
  install: { exe: string; folder: string; uninstaller: string };
  log: Logger;
  relaunch: boolean;
  setup: string;
}) {
  const userData = app.getPath("userData");
  // Velopack installs per user into %LOCALAPPDATA%, which sits beside the
  // roaming AppData Electron names.
  const velopackRoot = path.join(
    app.getPath("appData"),
    "..",
    "Local",
    APP_VELOPACK_ID,
  );
  const exeName = path.basename(install.exe);
  const shortcuts = [
    path.join(app.getPath("desktop"), `${APP_PRODUCT_NAME}.lnk`),
    path.join(
      app.getPath("appData"),
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
      `${APP_PRODUCT_NAME}.lnk`,
    ),
  ];
  const updaterCaches = updaterCacheDirs(
    readTextIfAny(path.join(install.folder, "resources", "app-update.yml")),
  ).map((name) => path.join(app.getPath("appData"), "..", "Local", name));
  const logFile = path.join(userData, BRIDGE_LOG_NAME);
  const failedFile = path.join(userData, MOVE_FAILED_NAME);
  const script = `$ErrorActionPreference = 'Continue'
$log = ${quote(logFile)}
function Log($m) { Add-Content -LiteralPath $log -Value "$(Get-Date -Format o) $m" }
function Fail($m) { Log $m; Set-Content -LiteralPath ${quote(failedFile)} -Value "$(Get-Date -Format o) $m" }
Log 'move to Velopack starting'
Wait-Process -Id ${process.pid} -Timeout 120 -ErrorAction SilentlyContinue
$setup = Start-Process -FilePath ${quote(setup)} -ArgumentList '--silent' -Wait -PassThru
Log "Setup exited $($setup.ExitCode)"
if (-not (Test-Path -LiteralPath ${quote(path.join(velopackRoot, "current", exeName))})) {
  Fail 'Setup left no app; keeping the NSIS install'
  if ($${relaunch ? "true" : "false"}) { Start-Process -FilePath ${quote(install.exe)} }
  exit 1
}
$kept = @()
foreach ($link in @(${shortcuts.map(quote).join(", ")})) {
  if (Test-Path -LiteralPath $link) {
    $copy = Join-Path $env:TEMP ("instrument-move-" + [guid]::NewGuid() + ".lnk")
    Copy-Item -LiteralPath $link -Destination $copy -Force
    $kept += ,@($link, $copy)
  }
}
Start-Process -FilePath ${quote(install.uninstaller)} -ArgumentList '/S' -Wait
$deadline = (Get-Date).AddSeconds(120)
while ((Test-Path -LiteralPath ${quote(install.exe)}) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
if (Test-Path -LiteralPath ${quote(install.exe)}) {
  Fail 'NSIS install not removed; both installs remain'
} else {
  Log 'NSIS install removed'
}
# The uninstaller leaves its folder behind, empty.
if ((Test-Path -LiteralPath ${quote(install.folder)}) -and -not (Get-ChildItem -LiteralPath ${quote(install.folder)} -Force | Select-Object -First 1)) {
  Remove-Item -LiteralPath ${quote(install.folder)} -Force -ErrorAction SilentlyContinue
}
foreach ($cache in @(${updaterCaches.map(quote).join(", ")})) {
  if (Test-Path -LiteralPath $cache) {
    Remove-Item -LiteralPath $cache -Recurse -Force -ErrorAction SilentlyContinue
    Log "Removed $($cache): $(-not (Test-Path -LiteralPath $cache))"
  }
}
foreach ($pair in $kept) {
  Copy-Item -LiteralPath $pair[1] -Destination $pair[0] -Force
  Remove-Item -LiteralPath $pair[1] -Force
}
Remove-Item -LiteralPath ${quote(path.dirname(setup))} -Recurse -Force -ErrorAction SilentlyContinue
if ($${relaunch ? "true" : "false"}) { Start-Process -FilePath ${quote(path.join(velopackRoot, exeName))} }
Log 'move to Velopack done'
`;
  const scriptFile = path.join(userData, "windows-velopack-move.ps1");
  fs.writeFileSync(scriptFile, `\uFEFF${script}`, "utf8");
  // Through `start`, which gives PowerShell a console of its own and a
  // process outside this one's: started directly, PowerShell never ran when
  // detached (no console) and was ended with the app when attached, since
  // Node puts an attached child in a job that closes with its parent. Both
  // tried on the Windows test host.
  // Written out as cmd reads it, with the script's path quoted once, since a
  // home folder's name can have spaces in it.
  spawn(
    "cmd.exe",
    [
      `/d /c start "" /min powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${scriptFile}"`,
    ],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      windowsVerbatimArguments: true,
    },
  ).unref();
  log.info(`Handed the move to Velopack to ${scriptFile}`);
}

function readTextIfAny(file: string) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Logs what the move to Velopack did, once, on the first launch after it:
 * the Velopack copy's after a move that worked, the NSIS copy's after one
 * that failed.
 */
export function reportMoveToVelopack(log: Logger) {
  const file = path.join(app.getPath("userData"), BRIDGE_LOG_NAME);
  try {
    const contents = fs.readFileSync(file, "utf8").trim().slice(-8000);
    fs.rmSync(file, { force: true });
    fs.rmSync(path.join(app.getPath("userData"), "windows-velopack-move.ps1"), {
      force: true,
    });
    if (contents) {
      log.info(`Move to Velopack:\n${contents}`);
    }
  } catch {
    // Nothing moved.
  }
}

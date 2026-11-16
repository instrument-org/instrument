import { execa } from "execa";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import { inheritedEnv } from "../native-env";
import {
  appNativeReach,
  launchNative,
  wrapNativeCommand,
} from "../native-sandbox";
import { runtimeLayout } from "../runtime-dir";
import { getWorkspaceConfig } from "../workspace-config";
import {
  atLeastPinnedMajor,
  type OfficeArtifact,
  officeArtifact,
  officeDownloadUrl,
  OFFICE_VERSION,
} from "./manifest";
import {
  profileKeepsSettings,
  profileUrl,
  writeProfileTemplate,
} from "./profile";
import {
  findSoffice,
  macSignatureProblem,
  sha256Of,
  unpackDebTarball,
  unpackDmg,
  unpackMsi,
} from "./unpack";

/** A LibreOffice `office` can run. */
export type OfficeInstall = {
  /** The profile each call copies (`freshProfile`). */
  profileTemplate: string;
  soffice: string;
  /** Downloaded by the app, or the person's own. */
  source: "downloaded" | "own";
  version: string;
};

/** Written into a version's folder before it is renamed into place. */
const INSTALL_RECORD = "instrument-office.json";

const InstallRecordSchema = z.object({
  /** `soffice`, relative to the version's folder. */
  soffice: z.string(),
  version: z.string(),
});

const LOCK_FILE = "install.lock";
const PROFILE_FOLDER = "profile";
/** The profile for a LibreOffice of the person's, beside the versions. */
const OWN_PROFILE_FOLDER = "own-profile";

const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;
const WARM_UP_TIMEOUT_MS = 2 * 60 * 1000;
/** How long a call waits on another process's install before giving up. */
const WAIT_FOR_OTHER_MS = 40 * 60 * 1000;

export function officeRoot(): string {
  return runtimeLayout(getWorkspaceConfig().runtimeDir).office;
}

function versionDir(version = OFFICE_VERSION) {
  return path.join(officeRoot(), version);
}

/** The pinned version, when it is installed whole. */
export function downloadedOffice(): OfficeInstall | undefined {
  const dir = versionDir();
  let record: z.output<typeof InstallRecordSchema>;
  try {
    record = InstallRecordSchema.parse(
      // oxlint-disable-next-line studio/no-sync-content-read -- the runtime folder is on this computer's own disk
      JSON.parse(readFileSync(path.join(dir, INSTALL_RECORD), "utf8")),
    );
  } catch {
    return undefined;
  }
  const soffice = path.join(dir, record.soffice);
  return existsSync(soffice)
    ? {
        profileTemplate: path.join(dir, PROFILE_FOLDER),
        soffice,
        source: "downloaded",
        version: record.version,
      }
    : undefined;
}

let ownInstall: Promise<OfficeInstall | undefined> | undefined;

/**
 * A LibreOffice the person installed, at or above the pinned release line,
 * found once a run of the app. It runs with the app's profile, so their
 * own settings never apply.
 */
export function ownOffice(): Promise<OfficeInstall | undefined> {
  ownInstall ??= findOwnOffice().catch(() => undefined);
  return ownInstall;
}

async function findOwnOffice(): Promise<OfficeInstall | undefined> {
  const found = await ownOfficeCandidate();
  if (!found || !atLeastPinnedMajor(found.version)) {
    return undefined;
  }
  const profileTemplate = path.join(officeRoot(), OWN_PROFILE_FOLDER);
  await writeProfileTemplate(profileTemplate);
  return {
    profileTemplate,
    soffice: found.soffice,
    source: "own",
    version: found.version,
  };
}

async function ownOfficeCandidate(): Promise<
  { soffice: string; version: string } | undefined
> {
  if (process.platform === "darwin") {
    for (const app of [
      "/Applications/LibreOffice.app",
      path.join(os.homedir(), "Applications", "LibreOffice.app"),
    ]) {
      const soffice = path.join(app, "Contents", "MacOS", "soffice");
      const plist = await fs
        .readFile(path.join(app, "Contents", "Info.plist"), "utf8")
        .catch(() => "");
      const version =
        /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(
          plist,
        )?.[1];
      if (version && existsSync(soffice)) {
        return { soffice, version };
      }
    }
    return undefined;
  }
  if (process.platform === "win32") {
    return windowsOwnOffice();
  }
  for (const soffice of [
    ...(process.env.PATH ?? "")
      .split(path.delimiter)
      .filter((dir) => path.isAbsolute(dir))
      .map((dir) => path.join(dir, "soffice")),
    "/usr/lib/libreoffice/program/soffice",
  ]) {
    if (!existsSync(soffice)) {
      continue;
    }
    const version = await sofficeVersion(soffice);
    if (version) {
      return { soffice, version };
    }
  }
  return undefined;
}

/** `LibreOffice 26.2.7.3 08df…` → `26.2.7.3`. */
export function versionFromBanner(banner: string): string | undefined {
  return /LibreOffice\S*\s+(\d+\.\d+(?:\.\d+)*)/.exec(banner)?.[1];
}

async function sofficeVersion(soffice: string): Promise<string | undefined> {
  const result = await execa(soffice, ["--version"], {
    all: true,
    cancelSignal: AbortSignal.timeout(30_000),
    reject: false,
    stdin: "ignore",
  });
  return versionFromBanner(result.all ?? "");
}

/**
 * The installer's own record of where it put LibreOffice
 * (`HKLM\SOFTWARE\LibreOffice\UNO\InstallPath`, the `program` folder) and
 * the release lines it registered under `HKLM\SOFTWARE\LibreOffice\LibreOffice`.
 */
async function windowsOwnOffice(): Promise<
  { soffice: string; version: string } | undefined
> {
  const query = async (key: string, args: string[]) =>
    (
      await execa("reg", ["query", key, ...args], {
        reject: false,
        stdin: "ignore",
      })
    ).stdout;
  const programDir = /REG_SZ\s+(.+)$/m
    .exec(
      await query("HKLM\\SOFTWARE\\LibreOffice\\UNO\\InstallPath", ["/ve"]),
    )?.[1]
    ?.trim();
  if (!programDir) {
    return undefined;
  }
  const soffice = path.join(programDir, "soffice.exe");
  const lines = [
    ...(await query("HKLM\\SOFTWARE\\LibreOffice\\LibreOffice", [])).matchAll(
      /\\LibreOffice\\(\d+\.\d+)\s*$/gm,
    ),
  ]
    .map(([, line = ""]) => line)
    .sort((a, b) => (atLeastPinnedMajor(a, b) ? -1 : 1));
  return existsSync(soffice) && lines[0]
    ? { soffice, version: lines[0] }
    : undefined;
}

/** What an install says as it goes, a line at a time. */
export type InstallProgress = (line: string) => void;

export type OfficeFailure = { reason: string };

let installing: Promise<OfficeFailure | OfficeInstall> | undefined;

/**
 * A LibreOffice to run: the pinned one when it is installed, the person's
 * own when it is recent enough, or the pinned one downloaded now. One
 * install runs at a time on this computer; a failure (offline, say) is
 * tried again by the next call.
 */
export async function ensureOffice(
  progress: InstallProgress = () => undefined,
): Promise<OfficeFailure | OfficeInstall> {
  const installed = downloadedOffice() ?? (await ownOffice());
  if (installed) {
    return installed;
  }
  installing ??= installPinned(progress)
    .catch((error: unknown) => ({
      reason: error instanceof Error ? error.message : String(error),
    }))
    .finally(() => {
      installing = undefined;
    });
  return installing;
}

async function installPinned(
  progress: InstallProgress,
): Promise<OfficeFailure | OfficeInstall> {
  const artifact = officeArtifact();
  if (!artifact) {
    return {
      reason: `TDF builds no LibreOffice for ${process.platform} on ${process.arch}`,
    };
  }
  const root = officeRoot();
  await fs.mkdir(root, { recursive: true });
  const held = await holdLock(root, progress);
  if (!held) {
    return downloadedOffice() ?? { reason: "another install did not finish" };
  }
  try {
    // Another process may have finished it while this one waited.
    const already = downloadedOffice();
    if (already) {
      return already;
    }
    await removeLeftovers(root);
    const installed = await downloadAndUnpack(artifact, root, progress);
    await removeOtherVersions(root);
    return installed;
  } finally {
    await fs.rm(path.join(root, LOCK_FILE), { force: true });
  }
}

/**
 * Takes the machine's install lock, waiting while another live process
 * holds it. False when that one ran past the wait.
 */
async function holdLock(
  root: string,
  progress: InstallProgress,
): Promise<boolean> {
  const lock = path.join(root, LOCK_FILE);
  const started = Date.now();
  let told = false;
  for (;;) {
    try {
      await fs.writeFile(lock, String(process.pid), { flag: "wx" });
      return true;
    } catch (error) {
      if (!isCode(error, "EEXIST")) {
        throw error;
      }
    }
    const holder = Number(await fs.readFile(lock, "utf8").catch(() => ""));
    if (!processAlive(holder)) {
      await fs.rm(lock, { force: true });
      continue;
    }
    if (Date.now() - started > WAIT_FOR_OTHER_MS) {
      return false;
    }
    if (!told) {
      progress(
        "Another Instrument window is installing LibreOffice; waiting for it.",
      );
      told = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (downloadedOffice()) {
      return false;
    }
  }
}

async function downloadAndUnpack(
  artifact: OfficeArtifact,
  root: string,
  progress: InstallProgress,
): Promise<OfficeInstall> {
  const started = Date.now();
  const tag = `${process.pid}-${randomUUID()}`;
  const download = path.join(root, `.download-${tag}-${artifact.file}`);
  const staging = path.join(root, `.${OFFICE_VERSION}.building-${tag}`);
  try {
    const megabytes = Math.round(artifact.bytes / 1e6);
    progress(
      `Downloading LibreOffice ${OFFICE_VERSION} (${megabytes} MB), once for this computer…`,
    );
    await downloadFile(officeDownloadUrl(artifact), download, (bytes) => {
      progress(
        `  ${Math.floor((bytes / artifact.bytes) * 100)}% of ${megabytes} MB`,
      );
    });
    const sum = await sha256Of(download);
    if (sum !== artifact.sha256) {
      throw new Error(
        `the download's SHA-256 is ${sum}, not the pinned ${artifact.sha256}`,
      );
    }
    progress("Unpacking…");
    if (artifact.file.endsWith(".dmg")) {
      await unpackDmg(download, staging);
    } else if (artifact.file.endsWith(".msi")) {
      await unpackMsi(download, staging);
    } else {
      await unpackDebTarball(download, staging);
    }
    await fs.rm(download, { force: true });
    const relative = await findSoffice(staging);
    if (!relative) {
      throw new Error("the unpacked build has no soffice");
    }
    if (process.platform === "darwin") {
      const app = relative.split("/Contents/")[0] ?? relative;
      const problem = await macSignatureProblem(path.join(staging, app));
      if (problem) {
        throw new Error(
          `the app is not TDF's, signed and unchanged: ${problem}`,
        );
      }
    }
    const profile = path.join(staging, PROFILE_FOLDER);
    await warmUp(path.join(staging, relative), profile, staging);
    await fs.writeFile(
      path.join(staging, INSTALL_RECORD),
      `${JSON.stringify({ soffice: relative, version: OFFICE_VERSION })}\n`,
    );
    await fs.rename(staging, versionDir());
    progress(
      `Installed LibreOffice ${OFFICE_VERSION} in ${Math.round((Date.now() - started) / 1000)}s.`,
    );
    const installed = downloadedOffice();
    if (!installed) {
      throw new Error("the install was not where it was put");
    }
    return installed;
  } finally {
    await fs.rm(download, { force: true });
    await fs.rm(staging, { force: true, recursive: true });
  }
}

/** Streams `url` to `file`, reporting each further tenth of it. */
async function downloadFile(
  url: string,
  file: string,
  onTenth: (bytes: number) => void,
): Promise<void> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  }).catch((error: unknown) => {
    throw new Error(
      `could not reach downloadarchive.documentfoundation.org (${error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error)})`,
    );
  });
  if (!response.ok || !response.body) {
    throw new Error(`the download failed with HTTP ${response.status}`);
  }
  const total = Number(response.headers.get("content-length")) || 0;
  let received = 0;
  let tenth = 0;
  const reader = response.body.getReader();
  const handle = await fs.open(file, "w");
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      await handle.write(value);
      received += value.length;
      const now = total > 0 ? Math.floor((received / total) * 10) : 0;
      if (now > tenth && now < 10) {
        tenth = now;
        onTenth(received);
      }
    }
  } finally {
    await handle.close();
  }
}

/**
 * Starts the new build once with the profile it will copy for every call,
 * which is the first launch's slow start paid at install, and the check
 * that it runs at all on this computer (a Linux system missing a library
 * fails here, with LibreOffice's own message). Held like any program the
 * app starts: it may change only the folder it is being installed in.
 */
async function warmUp(soffice: string, profile: string, staging: string) {
  await writeProfileTemplate(profile);
  const temp = path.join(staging, ".tmp");
  await fs.mkdir(temp, { recursive: true });
  const spawned = wrapNativeCommand(
    soffice,
    [
      `-env:UserInstallation=${profileUrl(profile)}`,
      "--headless",
      "--norestore",
      "--nologo",
      "--terminate_after_init",
    ],
    appNativeReach([staging]),
  );
  const env = {
    ...inheritedEnv(process.env, spawned),
    TEMP: temp,
    TMP: temp,
    TMPDIR: temp,
  };
  const launch = launchNative(spawned, { env });
  const result = await execa(launch.file, launch.args, {
    all: true,
    cancelSignal: AbortSignal.timeout(WARM_UP_TIMEOUT_MS),
    env,
    extendEnv: false,
    reject: false,
    stdin: "ignore",
  });
  await fs.rm(temp, { force: true, recursive: true });
  if (result.exitCode !== 0) {
    throw new Error(
      `LibreOffice did not start (exit ${String(result.exitCode)}): ${(result.all ?? "").trim().slice(0, 2000)}`,
    );
  }
  // What it rewrote on exit is put back, so every call runs with ours.
  if (!(await profileKeepsSettings(profile))) {
    await writeProfileTemplate(profile);
  }
  await fs.rm(path.join(profile, "user", "temp"), {
    force: true,
    recursive: true,
  });
}

/** Downloads and staging folders a process that ended left behind. */
async function removeLeftovers(root: string) {
  for (const entry of await fs.readdir(root).catch(() => [])) {
    const pid = /^\.(?:download|.+\.building)-(\d+)-/.exec(entry)?.[1];
    if (pid !== undefined && !processAlive(Number(pid))) {
      await fs
        .rm(path.join(root, entry), { force: true, recursive: true })
        .catch(() => undefined);
    }
  }
}

/**
 * Every version but the pinned one: a call still running from an older
 * version holds its files open, which on Windows fails the removal, and it
 * is tried again at the next install.
 */
async function removeOtherVersions(root: string) {
  for (const entry of await fs.readdir(root).catch(() => [])) {
    if (/^\d+(\.\d+)+$/.test(entry) && entry !== OFFICE_VERSION) {
      await fs
        .rm(path.join(root, entry), { force: true, recursive: true })
        .catch(() => undefined);
    }
  }
}

/** The downloaded install's version and size, for Settings. */
export async function officeStorage(): Promise<
  undefined | { bytes: number; path: string; version: string }
> {
  const root = officeRoot();
  const versions = (await fs.readdir(root).catch(() => [])).filter((entry) =>
    /^\d+(\.\d+)+$/.test(entry),
  );
  if (versions.length === 0) {
    return undefined;
  }
  return {
    bytes: await folderBytes(root),
    path: root,
    version: versions.sort().at(-1) ?? OFFICE_VERSION,
  };
}

async function folderBytes(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await fs
    .readdir(dir, { recursive: true, withFileTypes: true })
    .catch(() => [])) {
    if (entry.isFile()) {
      total += await fs
        .lstat(path.join(entry.parentPath, entry.name))
        .then((stat) => stat.size)
        .catch(() => 0);
    }
  }
  return total;
}

/**
 * Removes every downloaded version. The next `office` call downloads the
 * pinned one again. Refused while an install is running.
 */
export async function removeOffice(): Promise<OfficeFailure | undefined> {
  const root = officeRoot();
  const holder = Number(
    await fs.readFile(path.join(root, LOCK_FILE), "utf8").catch(() => ""),
  );
  if (installing || processAlive(holder)) {
    return { reason: "installing" };
  }
  await fs.rm(root, { force: true, maxRetries: 3, recursive: true });
  // The `soffice` wrapper names what is gone; a LibreOffice of the
  // person's gets it again at its next call.
  const bin = runtimeLayout(getWorkspaceConfig().runtimeDir).bin;
  for (const name of ["soffice", "soffice.cmd"]) {
    await fs.rm(path.join(bin, name), { force: true });
  }
  return undefined;
}

function isCode(error: unknown, code: string) {
  return error instanceof Error && "code" in error && error.code === code;
}

function processAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isCode(error, "EPERM");
  }
}

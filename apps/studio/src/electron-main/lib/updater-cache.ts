import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import semver from "semver";

/**
 * Where electron-updater keeps its cache folders: `~/Library/Caches` on
 * macOS, the XDG cache on Linux. The folder's own name is the one the app's
 * `app-update.yml` gives (`updaterCacheDirs`). Windows updates through
 * Velopack, which keeps its packages in its own install.
 */
export function updaterCacheRoot({
  env = process.env,
  home = os.homedir(),
  platform = process.platform,
}: {
  env?: NodeJS.ProcessEnv;
  home?: string;
  platform?: NodeJS.Platform;
} = {}): string | undefined {
  if (platform === "darwin") {
    // oxlint-disable-next-line studio/no-os-words -- a macOS path, never shown
    return path.join(home, "Library", "Caches");
  }
  if (platform === "linux") {
    return env.XDG_CACHE_HOME || path.join(home, ".cache");
  }
  return undefined;
}

/**
 * Removes the download in `pending/` once this version or a newer one is
 * running: it has been installed, and nothing reads it again until the next
 * download replaces it. The copy beside it, `update.zip`, stays, since the
 * next update downloads only what differs from it. A download it cannot
 * read the version of is left alone.
 */
export function removeInstalledDownload({
  cacheDir,
  running,
}: {
  cacheDir: string;
  running: string;
}): boolean {
  const pending = path.join(cacheDir, "pending");
  let fileName: unknown;
  try {
    ({ fileName } = JSON.parse(
      fs.readFileSync(path.join(pending, "update-info.json"), "utf8"),
    ) as { fileName?: unknown });
  } catch {
    return false;
  }
  const version =
    typeof fileName === "string"
      ? /-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)-/.exec(fileName)?.[1]
      : undefined;
  if (!version || !semver.valid(version) || semver.gt(version, running)) {
    return false;
  }
  fs.rmSync(pending, { force: true, recursive: true });
  return true;
}

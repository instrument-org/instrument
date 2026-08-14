import { APP_NAME } from "@instrument-org/shared";
import { Arch } from "electron-builder";
import { existsSync } from "node:fs";
import path from "node:path";

export type ElectronPlatform = "darwin" | "linux" | "win32";

export function isElectronPlatform(value: string): value is ElectronPlatform {
  return value === "darwin" || value === "linux" || value === "win32";
}

/**
 * Locate a packaged ffmpeg or ffprobe binary within the unpacked tree, or
 * `undefined` if it is missing. Both ship in `ffmpeg-ffprobe-static`, at the
 * package root rather than under `bin/`.
 *
 * They are spawned as subprocesses, so they have to be on the real filesystem
 * rather than inside the asar -- `unpackAsarPath` in the workspace package
 * rewrites their path on that assumption, and a binary that never got unpacked
 * would leave it pointing at nothing.
 */
export function resolvePackagedFfmpeg(
  appOutDir: string,
  platformName: ElectronPlatform,
  name: "ffmpeg" | "ffprobe",
) {
  const candidate = path.join(
    resolveUnpackedDir(appOutDir, platformName),
    "node_modules",
    "ffmpeg-ffprobe-static",
    platformName === "win32" ? `${name}.exe` : name,
  );

  return existsSync(candidate) ? candidate : undefined;
}

/**
 * Locate the packaged pnpm CLI entry within the unpacked tree, or `undefined`
 * if it is missing. Forked as a subprocess to install task dependencies, so it
 * must be unpacked; pnpm 11 no longer unpacks automatically (see the
 * `asarUnpack` note in electron-builder.ts), which this guards against.
 */
export function resolvePackagedPnpm(
  appOutDir: string,
  platformName: ElectronPlatform,
) {
  const candidate = path.join(
    resolveUnpackedDir(appOutDir, platformName),
    "node_modules",
    "pnpm",
    "bin",
    "pnpm.mjs",
  );

  return existsSync(candidate) ? candidate : undefined;
}

/**
 * Locate the packaged ripgrep binary within the unpacked tree, or `undefined`
 * if it is missing.
 */
export function resolvePackagedRipgrep(
  appOutDir: string,
  platformName: ElectronPlatform,
  arch: Arch,
) {
  const candidate = path.join(
    resolveUnpackedDir(appOutDir, platformName),
    "node_modules",
    ...ripgrepPlatformPackage(platformName, arch).split("/"),
    "bin",
    platformName === "win32" ? "rg.exe" : "rg",
  );

  return existsSync(candidate) ? candidate : undefined;
}

/**
 * Locate the packaged uv binary within the unpacked tree, or `undefined` if it
 * is missing. Vendored into `resources/uv/` by scripts/download-uv.ts and
 * unpacked via `asarUnpack: ["resources/**"]`.
 */
export function resolvePackagedUv(
  appOutDir: string,
  platformName: ElectronPlatform,
) {
  const candidate = path.join(
    resolveUnpackedDir(appOutDir, platformName),
    "resources",
    "uv",
    platformName === "win32" ? "uv.exe" : "uv",
  );

  return existsSync(candidate) ? candidate : undefined;
}

/**
 * Resolve the packaged `app.asar.unpacked` directory for a given build. macOS
 * nests it inside the `.app` bundle; Windows/Linux place it under `resources/`.
 */
export function resolveUnpackedDir(
  appOutDir: string,
  platformName: ElectronPlatform,
) {
  return platformName === "darwin"
    ? path.join(
        appOutDir,
        `${APP_NAME}.app`,
        "Contents",
        "Resources",
        "app.asar.unpacked",
      )
    : path.join(appOutDir, "resources", "app.asar.unpacked");
}

/**
 * Name of the per-platform `@vscode/ripgrep-<platform>-<arch>` package that
 * ships the prebuilt binary. Since 1.18.0 the binary lives in these optional
 * dependency packages instead of being downloaded by a postinstall script.
 * Mirrors the package's own naming: `@vscode/ripgrep-${os}-${cpu}` where the
 * `cpu` is the Node arch name (`x64`, `arm64`, `ia32`), matching the
 * electron-builder `Arch` enum keys.
 */
function ripgrepPlatformPackage(platformName: ElectronPlatform, arch: Arch) {
  return `@vscode/ripgrep-${platformName}-${Arch[arch]}`;
}

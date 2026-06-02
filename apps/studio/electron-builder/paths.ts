import { APP_NAME } from "@instrument-org/shared";
import { existsSync } from "node:fs";
import path from "node:path";

export type ElectronPlatform = "darwin" | "linux" | "win32";

export function isElectronPlatform(value: string): value is ElectronPlatform {
  return value === "darwin" || value === "linux" || value === "win32";
}

/**
 * Locate the packaged ripgrep binary within the unpacked tree, or `undefined`
 * if it is missing.
 */
export function resolvePackagedRipgrep(
  appOutDir: string,
  platformName: ElectronPlatform,
) {
  const candidate = path.join(
    resolveUnpackedDir(appOutDir, platformName),
    "node_modules",
    "@vscode",
    "ripgrep",
    "bin",
    platformName === "win32" ? "rg.exe" : "rg",
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

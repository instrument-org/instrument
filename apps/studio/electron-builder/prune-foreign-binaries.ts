// Trims per-platform/arch native binaries that ship for every OS/arch but are
// only runnable on the build target. electron-builder copies the full
// `node_modules` tree into `app.asar.unpacked`, so a package that vendors a
// binary per platform, as pnpm's reflink addon does, bloats each build with
// foreign binaries it can never execute. We prune them in `afterPack`,
// keying off the build's platform/arch so the kept binary always matches the
// runtime resolver.
//
// Loaded as TS directly: electron-builder runs configs through jiti, so no
// separate compile step is needed.

import { Arch } from "electron-builder";
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

import type { ElectronPlatform } from "./paths";

/**
 * Remove foreign-platform/arch vendored binaries from a packaged
 * `app.asar.unpacked` directory. Returns the list of removed file names so the
 * caller can log what was trimmed.
 */
export function pruneForeignBinaries({
  arch,
  platformName,
  unpackedDir,
}: {
  arch: Arch;
  platformName: ElectronPlatform;
  unpackedDir: string;
}) {
  const resolvedArch = archName(arch);
  if (!resolvedArch) {
    return [];
  }

  return prunePnpmReflink({
    arch: resolvedArch,
    platform: platformName,
    unpackedDir,
  });
}

function archName(arch: Arch): string | undefined {
  switch (arch) {
    case Arch.arm64: {
      return "arm64";
    }
    case Arch.ia32: {
      return "ia32";
    }
    case Arch.x64: {
      return "x64";
    }
    default: {
      return;
    }
  }
}

// pnpm bundles the reflink addon as `@reflink/reflink-{platform}-{arch}`
// packages under `dist/node_modules/@reflink/`, one per target. Keep only the
// current platform+arch package and drop the rest; reflink is an optional
// copy-on-write store optimization that falls back cleanly when absent.
function prunePnpmReflink({
  arch,
  platform,
  unpackedDir,
}: {
  arch: string;
  platform: ElectronPlatform;
  unpackedDir: string;
}) {
  const reflinkDir = path.join(
    unpackedDir,
    "node_modules",
    "pnpm",
    "dist",
    "node_modules",
    "@reflink",
  );
  if (!existsSync(reflinkDir)) {
    return [];
  }

  // Windows packages carry a `-msvc` suffix (e.g. reflink-win32-x64-msvc);
  // darwin does not. The runtime picks the package matching the build target.
  const keep =
    platform === "win32"
      ? `reflink-win32-${arch}-msvc`
      : `reflink-${platform}-${arch}`;

  const removed: string[] = [];
  for (const entry of readdirSync(reflinkDir)) {
    if (!entry.startsWith("reflink-") || entry === keep) {
      continue;
    }
    rmSync(path.join(reflinkDir, entry), { force: true, recursive: true });
    removed.push(entry);
  }
  return removed;
}

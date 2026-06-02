// Trims per-platform/arch native binaries that ship for every OS/arch but are
// only runnable on the build target. electron-builder copies the full
// `node_modules` tree into `app.asar.unpacked`, so packages that vendor a
// binary per platform (agent-browser, pnpm's reflink addon) bloat each build
// with foreign binaries it can never execute. We prune them in `afterPack`,
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

  return [
    ...pruneAgentBrowser({
      arch: resolvedArch,
      platform: platformName,
      unpackedDir,
    }),
    ...prunePnpmReflink({
      arch: resolvedArch,
      platform: platformName,
      unpackedDir,
    }),
  ];
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

// agent-browser vendors `bin/agent-browser-{os}-{arch}[-musl][.exe]`. Keep only
// the binaries whose os+arch match this build; the runtime resolver in
// packages/workspace/src/lib/agent-browser.ts picks `agent-browser-{os}-{arch}`.
function pruneAgentBrowser({
  arch,
  platform,
  unpackedDir,
}: {
  arch: string;
  platform: ElectronPlatform;
  unpackedDir: string;
}) {
  const binDir = path.join(unpackedDir, "node_modules", "agent-browser", "bin");
  if (!existsSync(binDir)) {
    return [];
  }

  const removed: string[] = [];
  for (const entry of readdirSync(binDir)) {
    if (!entry.startsWith("agent-browser-")) {
      continue;
    }
    // Strip the `agent-browser-` prefix and any `.exe` suffix, leaving
    // `{os}-{arch}` or `{os}-musl-{arch}`.
    const descriptor = entry
      .slice("agent-browser-".length)
      .replace(/\.exe$/i, "");
    const keep =
      descriptor === `${platform}-${arch}` ||
      // Linux musl variant for the same arch is still a valid linux target.
      (platform === "linux" && descriptor === `linux-musl-${arch}`);
    if (keep) {
      continue;
    }
    rmSync(path.join(binDir, entry), { force: true });
    removed.push(entry);
  }
  return removed;
}

// pnpm bundles `dist/reflink.{platform}-{arch}-*.node` for every target. Keep
// only the current platform+arch addon.
function prunePnpmReflink({
  arch,
  platform,
  unpackedDir,
}: {
  arch: string;
  platform: ElectronPlatform;
  unpackedDir: string;
}) {
  const distDir = path.join(unpackedDir, "node_modules", "pnpm", "dist");
  if (!existsSync(distDir)) {
    return [];
  }

  const removed: string[] = [];
  for (const entry of readdirSync(distDir)) {
    if (!entry.startsWith("reflink.") || !entry.endsWith(".node")) {
      continue;
    }
    if (entry.startsWith(`reflink.${platform}-${arch}-`)) {
      continue;
    }
    rmSync(path.join(distDir, entry), { force: true });
    removed.push(entry);
  }
  return removed;
}

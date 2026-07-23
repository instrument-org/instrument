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
  const agentBrowserArch =
    platform === "win32" && arch === "arm64" ? "x64" : arch;

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
      descriptor === `${platform}-${agentBrowserArch}` ||
      // Linux musl variant for the same arch is still a valid linux target.
      (platform === "linux" && descriptor === `linux-musl-${agentBrowserArch}`);
    if (keep) {
      continue;
    }
    rmSync(path.join(binDir, entry), { force: true });
    removed.push(entry);
  }
  return removed;
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

  // cspell:ignore msvc
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

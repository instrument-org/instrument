// Orchestrates electron-builder's `afterPack` step: prune foreign-platform
// binaries, then verify the packaged ripgrep binary. Each hook is a pure
// function; this module is the only place that touches `AfterPackContext`.

import { type AfterPackContext, Arch } from "electron-builder";
import { existsSync } from "node:fs";

import {
  type ElectronPlatform,
  isElectronPlatform,
  resolvePackagedRipgrep,
  resolvePackagedUv,
  resolveUnpackedDir,
} from "./paths";
import { pruneForeignBinaries } from "./prune-foreign-binaries";
import { verifyRipgrepBinary } from "./verify-ripgrep";
import { verifyUvBinary } from "./verify-uv";

export function runAfterPack(context: AfterPackContext) {
  pruneForeignPackagedBinaries(context);
  verifyPackagedRipgrep(context);
  verifyPackagedUv(context);
}

// Only a binary matching the host platform AND arch can be executed during
// packaging; cross-platform (e.g. win on mac) or cross-arch (e.g. mac x64 on
// arm) builds still get a completeness size check.
function canExecuteForTarget({
  arch,
  platformName,
}: {
  arch: Arch;
  platformName: ElectronPlatform;
}): boolean {
  if (platformName !== process.platform) {
    return false;
  }
  const hostArch =
    process.arch === "ia32"
      ? Arch.ia32
      : process.arch === "x64"
        ? Arch.x64
        : process.arch === "arm64"
          ? Arch.arm64
          : undefined;
  return arch === hostArch;
}

function pruneForeignPackagedBinaries(context: AfterPackContext) {
  const platformName = context.electronPlatformName;
  if (!isElectronPlatform(platformName)) {
    return;
  }

  const unpackedDir = resolveUnpackedDir(context.appOutDir, platformName);
  if (!existsSync(unpackedDir)) {
    return;
  }

  const removed = pruneForeignBinaries({
    arch: context.arch,
    platformName,
    unpackedDir,
  });

  if (removed.length > 0) {
    console.log(
      `afterPack: pruned ${removed.length} foreign binaries: ${removed.join(", ")}`,
    );
  }
}

function verifyPackagedRipgrep(context: AfterPackContext) {
  const platformName = context.electronPlatformName;
  if (!isElectronPlatform(platformName)) {
    throw new Error(`Unsupported electron platform: ${platformName}`);
  }

  const binaryPath = resolvePackagedRipgrep(
    context.appOutDir,
    platformName,
    context.arch,
  );
  if (!binaryPath) {
    throw new Error(
      `Could not locate packaged ripgrep binary under ${context.appOutDir} for ${platformName} ${Arch[context.arch]}`,
    );
  }

  const { size, version } = verifyRipgrepBinary(binaryPath, {
    execute: canExecuteForTarget({ arch: context.arch, platformName }),
  });
  const detail = version ?? "size-only";
  console.log(
    `afterPack: verified ripgrep at ${binaryPath} (${size} bytes, ${detail})`,
  );
}

function verifyPackagedUv(context: AfterPackContext) {
  const platformName = context.electronPlatformName;
  if (!isElectronPlatform(platformName)) {
    throw new Error(`Unsupported electron platform: ${platformName}`);
  }

  const binaryPath = resolvePackagedUv(context.appOutDir, platformName);
  if (!binaryPath) {
    throw new Error(
      `Could not locate packaged uv binary under ${context.appOutDir} for ${platformName} ${Arch[context.arch]}. Run \`pnpm --filter @instrument-org/studio uv:download\` before packaging.`,
    );
  }

  const { size, version } = verifyUvBinary(binaryPath, {
    execute: canExecuteForTarget({ arch: context.arch, platformName }),
  });
  const detail = version ?? "size-only";
  console.log(
    `afterPack: verified uv at ${binaryPath} (${size} bytes, ${detail})`,
  );
}

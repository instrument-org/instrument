// Orchestrates electron-builder's `afterPack` step: prune foreign-platform
// binaries, verify the packaged ones, then write their licenses. Each hook is a
// pure function; this module is the only place that touches `AfterPackContext`.

import { type AfterPackContext, Arch } from "electron-builder";
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { THIRD_PARTY_LICENSES_DIR_NAME } from "../src/shared/third-party-licenses";
import { documentTypesWearingAppIcon } from "./file-associations";
import {
  type ElectronPlatform,
  isElectronPlatform,
  resolvePackagedFfmpeg,
  resolvePackagedPnpm,
  resolvePackagedRipgrep,
  resolvePackagedUutilsDir,
  resolvePackagedUv,
  resolveResourcesDir,
  resolveUnpackedDir,
} from "./paths";
import { pruneForeignBinaries } from "./prune-foreign-binaries";
import {
  pruneGitTooling,
  relinkGitBuiltins,
  verifyGitSurvived,
} from "./prune-git-tooling";
import {
  THIRD_PARTY_COMPONENTS,
  writeThirdPartyLicenses,
} from "./third-party-licenses";
import { verifyFfmpegBinary, verifyFfmpegChecksum } from "./verify-ffmpeg";
import { writeThirdPartyNotices } from "./third-party-notices";
import {
  findUnlicensedBinaries,
  verifyThirdPartyNotices,
} from "./verify-licenses";
import { verifyRipgrepBinary } from "./verify-ripgrep";
import { verifySeatbeltHelper } from "./verify-seatbelt-helper";
import { expectedUutils, verifyUutilsDir } from "./verify-uutils";
import { verifyUvBinary } from "./verify-uv";

export function runAfterPack(context: AfterPackContext) {
  pruneForeignPackagedBinaries(context);
  pruneUnreachableGitTooling(context);
  verifyPackagedRipgrep(context);
  verifyPackagedUv(context);
  verifyPackagedUutils(context);
  verifyPackagedPnpm(context);
  verifyPackagedFfmpeg(context);
  verifyPackagedMacBridge(context);
  dropAppIconFromDocumentTypes(context);
  writePackagedLicenses(context);
}

/**
 * Takes the app's icon off the document types electron-builder gave it to
 * (see documentTypesWearingAppIcon). Runs before signing, so the edited
 * Info.plist is the one sealed.
 */
function dropAppIconFromDocumentTypes(context: AfterPackContext) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }
  const plist = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    "Contents",
    "Info.plist",
  );
  const plutil = (args: string[]) =>
    execFileSync("plutil", args, { encoding: "utf8" });
  // A lone string is no JSON document to plutil, so the icon's name is read raw.
  const appIcon = plutil([
    "-extract",
    "CFBundleIconFile",
    "raw",
    "-o",
    "-",
    plist,
  ]).trim();
  // A preview build claims no file types (`fileAssociations: []`), so its
  // plist has no document types at all and `plutil` exits saying so. There
  // is nothing to take an icon off.
  let extracted: string;
  try {
    extracted = plutil([
      "-extract",
      "CFBundleDocumentTypes",
      "json",
      "-o",
      "-",
      plist,
    ]);
  } catch {
    console.log("afterPack: no document types to take the app icon off");
    return;
  }
  const types: unknown = JSON.parse(extracted);
  if (!appIcon || !Array.isArray(types)) {
    throw new Error(`Could not read the document types in ${plist}.`);
  }
  // Deleted from the last, so each index still names the type it did.
  const wearing = documentTypesWearingAppIcon(types, appIcon).toReversed();
  for (const index of wearing) {
    plutil([
      "-remove",
      `CFBundleDocumentTypes.${index}.CFBundleTypeIconFile`,
      plist,
    ]);
  }
  console.log(
    `afterPack: took the app icon off ${wearing.length} document types`,
  );
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

function pruneUnreachableGitTooling(context: AfterPackContext) {
  const platformName = context.electronPlatformName;
  if (!isElectronPlatform(platformName)) {
    return;
  }

  const unpackedDir = resolveUnpackedDir(context.appOutDir, platformName);
  if (!existsSync(unpackedDir)) {
    return;
  }

  const removed = pruneGitTooling({ unpackedDir });
  const relinked = relinkGitBuiltins({ unpackedDir });
  verifyGitSurvived({ unpackedDir });

  if (removed.length > 0) {
    console.log(
      `afterPack: pruned ${removed.length} unreachable git files: ${removed.join(", ")}`,
    );
  }
  if (relinked.length > 0) {
    console.log(
      `afterPack: relinked ${relinked.length} git builtins that were copies of their target`,
    );
  }
}

function verifyPackagedFfmpeg(context: AfterPackContext) {
  const platformName = context.electronPlatformName;
  if (!isElectronPlatform(platformName)) {
    throw new Error(`Unsupported electron platform: ${platformName}`);
  }

  for (const name of ["ffmpeg", "ffprobe"] as const) {
    const binaryPath = resolvePackagedFfmpeg(
      context.appOutDir,
      platformName,
      name,
    );
    if (!binaryPath) {
      throw new Error(
        `Could not locate packaged ${name} binary under ${context.appOutDir} for ${platformName} ${Arch[context.arch]}. It has to reach app.asar.unpacked, since every image and video read spawns it as a subprocess.`,
      );
    }

    const { size, version } = verifyFfmpegBinary(binaryPath, {
      execute: canExecuteForTarget({ arch: context.arch, platformName }),
      name,
    });
    verifyFfmpegChecksum(binaryPath, {
      arch: Arch[context.arch],
      name,
      platform: platformName,
    });
    const detail = `${version ?? "size-only"}, sha256 pinned`;
    console.log(
      `afterPack: verified ${name} at ${binaryPath} (${size} bytes, ${detail})`,
    );
  }
}

/**
 * Both halves of the Mac bridge (lib/mac-native.ts) are extraResources, which
 * electron-builder skips without a word when the file is missing: a build
 * once shipped without the helper because Swift wrote it to another folder.
 */
function verifyPackagedMacBridge(context: AfterPackContext) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }
  const binDir = path.join(
    resolveUnpackedDir(context.appOutDir, "darwin"),
    "..",
    "bin",
  );
  for (const name of ["instrument-mac", "instrument-mac.node"]) {
    const file = path.join(binDir, name);
    if (!existsSync(file)) {
      throw new Error(
        `Could not locate ${name} at ${file}. Run \`pnpm build:mac-helper\` before packaging; without it the agent has no calendar or contacts command and Settings cannot read notification permission.`,
      );
    }
    console.log(
      `afterPack: verified ${name} at ${file} (${statSync(file).size} bytes)`,
    );
  }
  const seatbelt = path.join(binDir, "instrument-seatbelt");
  const { size } = verifySeatbeltHelper(seatbelt, {
    execute: canExecuteForTarget({
      arch: context.arch,
      platformName: "darwin",
    }),
  });
  console.log(`afterPack: verified ${seatbelt} (${size} bytes)`);
}

/**
 * Every native program and WebAssembly module that shipped has a license
 * entry, `licenses/` beside the app's other resources holds their texts, and
 * the notices file in it covers the JavaScript packages the app carries.
 * Runs before signing, so the folder is sealed into the macOS signature.
 */
function writePackagedLicenses(context: AfterPackContext) {
  const platformName = context.electronPlatformName;
  if (!isElectronPlatform(platformName)) {
    throw new Error(`Unsupported electron platform: ${platformName}`);
  }

  const unlicensed = findUnlicensedBinaries({
    components: THIRD_PARTY_COMPONENTS,
    unpackedDir: resolveUnpackedDir(context.appOutDir, platformName),
  });
  if (unlicensed.length > 0) {
    throw new Error(
      `These packaged binaries have no license entry: ${unlicensed.join(", ")}. Add each to THIRD_PARTY_COMPONENTS in electron-builder/third-party-licenses.ts with its license texts.`,
    );
  }

  const outDir = path.join(
    resolveResourcesDir(context.appOutDir, platformName),
    THIRD_PARTY_LICENSES_DIR_NAME,
  );
  const entries = writeThirdPartyLicenses({ outDir, platformName });
  console.log(
    `afterPack: wrote licenses for ${entries.length} components to ${outDir}`,
  );

  const { file, notices, review } = writeThirdPartyNotices({
    asarPath: path.join(
      resolveResourcesDir(context.appOutDir, platformName),
      "app.asar",
    ),
    outDir,
  });
  verifyThirdPartyNotices(file);
  console.log(
    `afterPack: wrote notices for ${notices.length} JavaScript packages to ${file} (${statSync(file).size} bytes)`,
  );
  if (review.length > 0) {
    console.log(
      `afterPack: packages whose license is copyleft, unusual or missing, or that ship no text: ${review.map((notice) => `${notice.name}@${notice.version} (${notice.license})`).join(", ")}`,
    );
  }
}

function verifyPackagedPnpm(context: AfterPackContext) {
  const platformName = context.electronPlatformName;
  if (!isElectronPlatform(platformName)) {
    throw new Error(`Unsupported electron platform: ${platformName}`);
  }

  const binaryPath = resolvePackagedPnpm(context.appOutDir, platformName);
  if (!binaryPath) {
    throw new Error(
      `Could not locate packaged pnpm at node_modules/pnpm/bin/pnpm.mjs under ${context.appOutDir} for ${platformName} ${Arch[context.arch]}. It must be listed in electron-builder \`asarUnpack\` so it can be forked to install task dependencies.`,
    );
  }

  console.log(`afterPack: verified pnpm at ${binaryPath}`);
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

function verifyPackagedUutils(context: AfterPackContext) {
  const platformName = context.electronPlatformName;
  if (!isElectronPlatform(platformName)) {
    throw new Error(`Unsupported electron platform: ${platformName}`);
  }
  const dir = resolvePackagedUutilsDir(context.appOutDir, platformName);
  const verified = verifyUutilsDir(dir, expectedUutils(platformName), {
    execute: canExecuteForTarget({ arch: context.arch, platformName }),
  });
  console.log(`afterPack: verified uutils at ${dir} (${verified.join(", ")})`);
}

// Packs the Windows app electron-builder unpacked (and signed) into the
// Velopack release: per channel, a full package, a delta from that channel's
// previous release, the channel's Setup and its `releases.<channel>.json`, all
// in one folder the release uploads to the bucket's `velopack/`.
//
//   node scripts/velopack-pack.ts [--unpacked <dir>] [--out <dir>]
//     [--version <semver>] [--feed <url or folder of the previous releases>]
//
// Signing goes through the same cloud HSM electron-builder signs with, when
// WIN_GCP_KMS_KEY_VERSION is set; without it the packages are unsigned, which
// a released app refuses to install (lib/update-signature.ts).
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import semver from "semver";

import {
  APP_BUNDLE_ID,
  APP_FLAVOR,
  APP_PRODUCT_NAME,
  APP_VELOPACK_ID,
  VELOPACK_FEED_URL,
  WINDOWS_PUBLISHER_NAMES,
} from "../../../packages/shared/src/constants.ts";
import {
  judgeUpdatePackage,
  readSignatures,
  unpackPackageExecutables,
} from "../src/electron-main/lib/update-signature.ts";

const studioDir = path.resolve(import.meta.dirname, "..");
const studioPackage = JSON.parse(
  readFileSync(path.join(studioDir, "package.json"), "utf8"),
) as { dependencies: Record<string, string>; version: string };

// vpk and the SDK the app loads come from one release: the Update.exe a
// package carries is vpk's, and it has to speak the SDK's protocol.
const VELOPACK_VERSION = studioPackage.dependencies.velopack ?? "";

/**
 * The channels a version is released on, as electron-builder's update files
 * are (`generateUpdatesFilesForAllChannels`): a stable release reaches every
 * channel, a beta the beta and alpha ones, an alpha its own.
 */
export function channelsFor(version: string): string[] {
  const tag = semver.prerelease(version)?.[0];
  if (tag === undefined) {
    return ["latest", "beta", "alpha"];
  }
  if (tag === "beta") {
    return ["beta", "alpha"];
  }
  return [String(tag)];
}

function run(command: string, args: string[]) {
  console.log(`> ${command} ${args.join(" ")}`);
  execFileSync(command, args, { stdio: "inherit" });
}

function checkVpkVersion() {
  const installed = execFileSync("dotnet", ["tool", "list", "--global"], {
    encoding: "utf8",
  });
  const line = installed.split("\n").find((row) => /^vpk\s/.test(row));
  const version = line?.trim().split(/\s+/)[1];
  if (version !== VELOPACK_VERSION) {
    throw new Error(
      `vpk ${version ?? "is not installed"}; this build needs ${VELOPACK_VERSION}: dotnet tool install --global vpk --version ${VELOPACK_VERSION}`,
    );
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      feed: { type: "string" },
      out: { type: "string" },
      unpacked: { type: "string" },
      version: { type: "string" },
    },
  });
  const dist =
    process.env.ELECTRON_BUILDER_OUTPUT_DIR ?? path.join(studioDir, "dist");
  const unpacked = path.resolve(
    values.unpacked ?? path.join(dist, "win-unpacked"),
  );
  const out = path.resolve(values.out ?? path.join(dist, "velopack"));
  const version = values.version ?? studioPackage.version;
  const feed = values.feed ?? VELOPACK_FEED_URL;
  const mainExe = `${APP_PRODUCT_NAME}.exe`;
  if (!existsSync(path.join(unpacked, mainExe))) {
    throw new Error(`${mainExe} is not in ${unpacked}`);
  }
  checkVpkVersion();

  const icon = path.join(
    studioDir,
    "build",
    APP_FLAVOR.kind === "preview" ? "flavors/preview/icon.ico" : "icon.ico",
  );
  const signer = path.join(studioDir, "electron-builder", "win-sign-file.js");
  // A test host signs with a stand-in certificate through a command of its
  // own; a release always signs through the HSM.
  const template =
    process.env.VELOPACK_TEST_SIGN_TEMPLATE ??
    (process.env.WIN_GCP_KMS_KEY_VERSION
      ? `"${process.execPath}" "${signer}" "{{file}}"`
      : undefined);
  const signing = template ? ["--signTemplate", template] : [];
  if (signing.length === 0) {
    console.warn("No signing configured: packing unsigned");
  }

  rmSync(out, { force: true, recursive: true });
  mkdirSync(out, { recursive: true });
  for (const channel of channelsFor(version)) {
    // The channel's previous release, which the delta is made from. A first
    // release on a channel has none.
    try {
      run("vpk", [
        "download",
        ...(/^https?:\/\//i.test(feed)
          ? ["http", "--url", feed]
          : ["local", "--path", feed]),
        "--channel",
        channel,
        "--outputDir",
        out,
      ]);
    } catch {
      console.warn(
        `No earlier ${channel} release in ${feed}; packing without a delta`,
      );
    }
    run("vpk", [
      "pack",
      "--packId",
      APP_VELOPACK_ID,
      "--packVersion",
      version,
      "--packDir",
      unpacked,
      "--mainExe",
      mainExe,
      "--packTitle",
      APP_PRODUCT_NAME,
      "--packAuthors",
      "Finalpoint, LLC",
      "--channel",
      channel,
      // Toasts and taskbar grouping follow the shortcut's id, which has to
      // be the one the app gives itself (app.setAppUserModelId).
      "--aumid",
      APP_BUNDLE_ID,
      // Where the NSIS installer put them.
      "--shortcuts",
      "Desktop,StartMenuRoot",
      "--icon",
      icon,
      "--noPortable",
      "--outputDir",
      out,
      ...signing,
    ]);
  }
  if (template) {
    await checkSignatures(out, mainExe);
  }
}

/**
 * Runs the check the installed app makes before applying an update over
 * every full package just packed, so a release whose signing missed a file
 * fails here rather than being refused by every app it would have updated,
 * which could then never take the release that fixes it.
 */
async function checkSignatures(out: string, mainExe: string) {
  for (const name of readdirSync(out).filter((file) =>
    file.endsWith("-full.nupkg"),
  )) {
    const unpacked = await unpackPackageExecutables(path.join(out, name));
    try {
      const verdict = judgeUpdatePackage({
        mainExe,
        publisherNames: WINDOWS_PUBLISHER_NAMES,
        reports: await readSignatures(unpacked.folder),
      });
      if (!verdict.ok) {
        throw new Error(
          `${name} would be refused by the app: ${verdict.problems.join("; ")}`,
        );
      }
      console.log(`${name}: ${verdict.checked} executables signed`);
    } finally {
      unpacked.dispose();
    }
  }
}

if (import.meta.main) {
  await main();
}

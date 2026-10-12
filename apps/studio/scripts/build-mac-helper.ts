// Builds both halves of the Mac bridge, universal binaries that
// electron-builder copies into the app's resources (`mac.extraResources`):
//
// - instrument-mac, the helper process behind the agent's `calendar` and
//   `contacts` commands (Swift, native/mac-helper/Sources);
// - instrument-mac.node, the module main loads for what macOS keys to the
//   app itself, like notification permission, and for what the file browser
//   asks of every folder it lists (Objective-C over Node-API,
//   native/mac-helper/addon). Node-API is ABI-stable, so it is built once
//   against Node's headers and loads in any Electron.
//
// macOS only: both reach frameworks that exist nowhere else, and the
// toolchain is a Mac's. Runs before every package build (see
// apps/studio/package.json `build:vite`), and from a checkout so `pnpm dev`
// finds them too.
//
// `--host-arch` builds for this Mac's architecture alone, which is what the
// dev supervisor asks for: a universal Swift build needs Xcode's build
// system, which a Mac with only the Command Line Tools does not have.

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const helperDir = path.resolve(import.meta.dirname, "../native/mac-helper");
// Where both land, whatever folder this Swift puts its products in (it has
// varied by Xcode: .build/out, .build/apple), so packaging and the app look
// in one place.
const outDir = path.join(helperDir, ".build/bridge");

const target = process.env.TARGET_PLATFORM ?? process.platform;
if (target !== "darwin" || process.platform !== "darwin") {
  console.log(
    `build-mac-helper: skipped, the bridge is macOS only (${target}).`,
  );
} else {
  const archs = process.argv.includes("--host-arch")
    ? [process.arch === "x64" ? "x86_64" : process.arch]
    : ["arm64", "x86_64"];
  const swiftArgs = [
    "build",
    "--package-path",
    helperDir,
    "-c",
    "release",
    // One architecture is built without `--arch`, which is what keeps it
    // working with the Command Line Tools alone.
    ...(archs.length > 1 ? archs.flatMap((arch) => ["--arch", arch]) : []),
  ];
  execFileSync("swift", swiftArgs, { stdio: "inherit" });
  const binPath = execFileSync("swift", [...swiftArgs, "--show-bin-path"], {
    encoding: "utf8",
  }).trim();
  mkdirSync(outDir, { recursive: true });
  copyFileSync(
    path.join(binPath, "instrument-mac"),
    path.join(outDir, "instrument-mac"),
  );
  const headers = path.join(
    path.dirname(
      createRequire(import.meta.url).resolve("node-api-headers/package.json"),
    ),
    "include",
  );
  execFileSync(
    "clang",
    [
      "-bundle",
      "-undefined",
      "dynamic_lookup",
      "-fobjc-arc",
      "-O2",
      ...archs.flatMap((arch) => ["-arch", arch]),
      "-mmacosx-version-min=13.0",
      "-I",
      headers,
      "-framework",
      "AppKit",
      "-framework",
      "Foundation",
      "-framework",
      "UserNotifications",
      path.join(helperDir, "addon/addon.m"),
      "-o",
      path.join(outDir, "instrument-mac.node"),
    ],
    { stdio: "inherit" },
  );
}

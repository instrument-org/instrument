// Builds both halves of the Mac bridge, universal binaries that
// electron-builder copies into the app's resources (`mac.extraResources`):
//
// - instrument-mac, the helper process behind the agent's `calendar` and
//   `contacts` commands (Swift, native/mac-helper/Sources);
// - instrument-mac.node, the module main loads for what macOS keys to the
//   app itself, like notification permission (Objective-C over Node-API,
//   native/mac-helper/addon). Node-API is ABI-stable, so it is built once
//   against Node's headers and loads in any Electron.
//
// macOS only: both reach frameworks that exist nowhere else, and the
// toolchain is a Mac's. Runs before every package build (see
// apps/studio/package.json `build:vite`), and from a checkout so `pnpm dev`
// finds them too.

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const helperDir = path.resolve(import.meta.dirname, "../native/mac-helper");
const outDir = path.join(helperDir, ".build/out/Products/Release");

const target = process.env.TARGET_PLATFORM ?? process.platform;
if (target !== "darwin" || process.platform !== "darwin") {
  console.log(
    `build-mac-helper: skipped, the bridge is macOS only (${target}).`,
  );
} else {
  execFileSync(
    "swift",
    [
      "build",
      "--package-path",
      helperDir,
      "-c",
      "release",
      "--arch",
      "arm64",
      "--arch",
      "x86_64",
    ],
    { stdio: "inherit" },
  );
  const headers = path.join(
    path.dirname(
      createRequire(import.meta.url).resolve("node-api-headers/package.json"),
    ),
    "include",
  );
  mkdirSync(outDir, { recursive: true });
  execFileSync(
    "clang",
    [
      "-bundle",
      "-undefined",
      "dynamic_lookup",
      "-fobjc-arc",
      "-O2",
      "-arch",
      "arm64",
      "-arch",
      "x86_64",
      "-mmacosx-version-min=13.0",
      "-I",
      headers,
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

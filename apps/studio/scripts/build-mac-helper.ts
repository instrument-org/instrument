// Builds the Mac helper behind the agent's `calendar` and `contacts`
// commands, a universal binary that electron-builder copies into the app's
// resources (`mac.extraResources`). macOS only: the helper reads Calendar,
// Reminders, and Contacts, which exist nowhere else, and Swift's toolchain
// is a Mac's.
// Runs before every package build (see apps/studio/package.json
// `build:vite`), and from a checkout so `pnpm dev` finds it too.

import { execFileSync } from "node:child_process";
import path from "node:path";

const target = process.env.TARGET_PLATFORM ?? process.platform;
if (target !== "darwin" || process.platform !== "darwin") {
  console.log(`build-mac-helper: skipped, the helper is macOS only (${target}).`);
} else {
  execFileSync(
    "swift",
    [
      "build",
      "--package-path",
      path.resolve(import.meta.dirname, "../native/mac-helper"),
      "-c",
      "release",
      "--arch",
      "arm64",
      "--arch",
      "x86_64",
    ],
    { stdio: "inherit" },
  );
}

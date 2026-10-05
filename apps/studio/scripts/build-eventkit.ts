// Builds the EventKit helper behind the agent's `calendar` command, a
// universal binary that electron-builder copies into the app's resources
// (`mac.extraResources`). macOS only: the helper reads Calendar and
// Reminders, which exist nowhere else, and Swift's toolchain is a Mac's.
// Runs before every package build (see apps/studio/package.json
// `build:vite`), and from a checkout so `pnpm dev` finds it too.

import { execFileSync } from "node:child_process";
import path from "node:path";

const target = process.env.TARGET_PLATFORM ?? process.platform;
if (target !== "darwin" || process.platform !== "darwin") {
  console.log(`build-eventkit: skipped, the helper is macOS only (${target}).`);
} else {
  execFileSync(
    "swift",
    [
      "build",
      "--package-path",
      path.resolve(import.meta.dirname, "../native/eventkit"),
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

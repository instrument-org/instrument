// The Mac bridge (native/mac-helper) built when either half is missing or
// older than what it is built from. A package build makes it as a step of its
// own; this is what keeps a dev run from going without it. A checkout that had
// never built it otherwise ran without a word about it, and lost everything
// behind it: Finder icons and packages in Files, notifications, Calendar and
// Contacts.
//
// Imported by the dev supervisor and the repo's prepare step, and runnable on
// its own: node apps/studio/scripts/mac-bridge.ts

import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const MAC_HELPER_DIR = path.resolve(
  import.meta.dirname,
  "../native/mac-helper",
);

/** The newest modification time among these files and every file under these folders. */
function newestMtime(paths: string[]): number {
  let newest = 0;
  for (const each of paths) {
    const stats = statSync(each, { throwIfNoEntry: false });
    if (!stats) {
      continue;
    }
    const files = stats.isDirectory()
      ? readdirSync(each, { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => path.join(entry.parentPath, entry.name))
      : [each];
    for (const file of files) {
      newest = Math.max(newest, statSync(file).mtimeMs);
    }
  }
  return newest;
}

/**
 * Builds the Mac bridge when either half is missing or older than what it is
 * built from. A failed build is said and passed over: the app runs without
 * the bridge, as it does off a Mac.
 */
export function ensureMacBridge() {
  if (process.platform !== "darwin") {
    return;
  }
  const outputs = ["instrument-mac", "instrument-mac.node"].map((name) =>
    path.join(MAC_HELPER_DIR, ".build/bridge", name),
  );
  const built = Math.min(
    ...outputs.map(
      (file) => statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? 0,
    ),
  );
  const sources = newestMtime([
    path.join(MAC_HELPER_DIR, "addon"),
    path.join(MAC_HELPER_DIR, "Sources"),
    path.join(MAC_HELPER_DIR, "Package.swift"),
    path.join(import.meta.dirname, "build-mac-helper.ts"),
  ]);
  if (built >= sources) {
    return;
  }
  process.stdout.write("[mac-bridge] building the Mac bridge\n");
  try {
    execFileSync(
      process.execPath,
      [path.join(import.meta.dirname, "build-mac-helper.ts"), "--host-arch"],
      { stdio: "inherit" },
    );
  } catch (error) {
    process.stderr.write(
      `[mac-bridge] running without the Mac bridge, since it did not build: ${String(error)}\n`,
    );
  }
}

if (import.meta.main) {
  ensureMacBridge();
}

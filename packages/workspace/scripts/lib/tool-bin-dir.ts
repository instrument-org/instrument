import fs from "node:fs";
import path from "node:path";

import { runtimeLayout } from "../../src/lib/runtime-dir";

/**
 * A stand-in for the app's own bin folder in `runtimeDir`: a `node` link to
 * the node running this process, first on PATH, so a package script or a
 * bin shim that calls `node` finds one the native sandbox lets it read, the
 * way the app's does.
 */
export function makeToolBinIn(runtimeDir: string): void {
  const binDir = runtimeLayout(runtimeDir).bin;
  fs.mkdirSync(binDir, { recursive: true });
  // Made beside it and renamed over it, so processes sharing one runtime
  // folder never find the link missing or race to make it. On Windows a
  // hardlink named node.exe: a symlink needs Developer Mode or an elevated
  // shell, and only an .exe is found by a program started without a shell.
  const isWindows = process.platform === "win32";
  const link = path.join(binDir, isWindows ? "node.exe" : "node");
  const staging = `${link}.${process.pid}`;
  fs.rmSync(staging, { force: true });
  if (isWindows) {
    fs.linkSync(process.execPath, staging);
  } else {
    fs.symlinkSync(process.execPath, staging);
  }
  fs.renameSync(staging, link);
  process.env.PATH = [binDir, process.env.PATH]
    .filter(Boolean)
    .join(path.delimiter);
}

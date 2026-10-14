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
  const link = path.join(binDir, "node");
  fs.rmSync(link, { force: true });
  fs.symlinkSync(process.execPath, link);
  process.env.PATH = [binDir, process.env.PATH]
    .filter(Boolean)
    .join(path.delimiter);
}

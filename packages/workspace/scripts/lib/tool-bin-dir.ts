import fs from "node:fs";
import path from "node:path";

/**
 * A stand-in for the app's own bin folder: a `node` link to the node running
 * this process, first on PATH, so a package script or a bin shim that calls
 * `node` finds one the native sandbox lets it read, the way the app's
 * `toolBinDir` does. Returns the folder for the workspace config.
 */
export function toolBinDirIn(rootDir: string): string {
  const binDir = path.join(rootDir, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const link = path.join(binDir, "node");
  fs.rmSync(link, { force: true });
  fs.symlinkSync(process.execPath, link);
  process.env.PATH = [binDir, process.env.PATH]
    .filter(Boolean)
    .join(path.delimiter);
  return binDir;
}

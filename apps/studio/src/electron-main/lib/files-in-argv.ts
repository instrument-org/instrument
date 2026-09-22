import { statSync } from "node:fs";
import path from "node:path";

/**
 * The files a launch was handed on its command line, which is how Windows
 * and Linux pass a file opened with Instrument. Skips the executable, and the
 * app path that follows it when Electron runs an app from source; the
 * switches Chromium adds; and any argument that is not a file.
 */
export function filesInArgv(
  argv: readonly string[],
  { defaultApp }: { defaultApp: boolean },
) {
  return argv
    .slice(defaultApp ? 2 : 1)
    .filter(
      (arg) => !arg.startsWith("-") && path.isAbsolute(arg) && isFile(arg),
    );
}

function isFile(filePath: string) {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

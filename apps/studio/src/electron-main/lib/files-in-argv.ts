import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The files a launch was handed on its command line, which is how Windows
 * and Linux pass a file opened with Instrument: a path, or on Linux a
 * `file://` URL, since the desktop entry takes URLs. Skips the executable,
 * and the app path that follows it when Electron runs an app from source;
 * the switches Chromium adds; and any argument that is not a file.
 */
export function filesInArgv(
  argv: readonly string[],
  { defaultApp }: { defaultApp: boolean },
) {
  return argv
    .slice(defaultApp ? 2 : 1)
    .filter((arg) => !arg.startsWith("-"))
    .map((arg) => pathOfArg(arg))
    .filter(
      (filePath): filePath is string =>
        filePath !== undefined && path.isAbsolute(filePath) && isFile(filePath),
    );
}

function isFile(filePath: string) {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function pathOfArg(arg: string) {
  if (!arg.startsWith("file:")) {
    return arg;
  }
  try {
    return fileURLToPath(arg);
  } catch {
    return;
  }
}

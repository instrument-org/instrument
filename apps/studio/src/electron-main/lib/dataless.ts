import { execFileSync } from "node:child_process";
import fs from "node:fs";

/** `SF_DATALESS` in `<sys/stat.h>`: the file's contents are only in the cloud. */
const SF_DATALESS = 0x40000000;

/**
 * Whether a file is on this computer by name only, its contents kept by a
 * cloud service (iCloud Drive, Desktop and Documents in iCloud, or another
 * service on the system's file provider) until something reads it, which
 * downloads it. Told by the file's own flag rather than by where it is, and
 * read without downloading it. Only macOS marks files so; anywhere else, and
 * whenever the flag can't be read, the answer is no.
 */
export function isDataless(file: string): boolean {
  if (process.platform !== "darwin") {
    return false;
  }
  try {
    // A file with contents and no blocks on disk is the only kind that can
    // be one, so most files are answered without starting `stat`.
    const stats = fs.statSync(file);
    if (!stats.isFile() || stats.blocks !== 0 || stats.size === 0) {
      return false;
    }
    const flags = Number.parseInt(
      execFileSync("/usr/bin/stat", ["-f", "%f", file], {
        encoding: "utf8",
        timeout: 2000,
      }).trim(),
      10,
    );
    return (flags & SF_DATALESS) !== 0;
  } catch {
    return false;
  }
}

import "dotenv/config";
import fs from "node:fs";

/**
 * Moves the run's temp folder off the boot disk when this computer names one.
 *
 * A run's workspace is about 600 MB and a long suite makes hundreds, and a
 * full boot disk stalls the whole machine, so a computer with room elsewhere
 * (an external drive) names a folder there as `INSTRUMENT_EVAL_TMPDIR` in its
 * own `packages/workspace/.env`. Everything a run makes under the temp folder
 * follows it: homes, workspaces, fixtures, the disk gate's free-space check,
 * and the processes it starts, which inherit `TMPDIR`.
 *
 * The folder has to exist already. A drive that is not mounted leaves its
 * mount point as an ordinary folder on the boot disk, so making the folder
 * would fill the very disk this avoids; the run keeps the system's temp
 * folder instead and says so once.
 */
const dir = process.env.INSTRUMENT_EVAL_TMPDIR;
if (dir) {
  if (fs.existsSync(dir)) {
    process.env.TMPDIR = dir;
    process.env.TEMP = dir;
    process.env.TMP = dir;
  } else {
    process.stderr.write(
      `INSTRUMENT_EVAL_TMPDIR names ${dir}, which does not exist (is its drive mounted?), so this run uses the system's temp folder.\n`,
    );
    // Said once: the processes this run starts inherit the system's folder.
    delete process.env.INSTRUMENT_EVAL_TMPDIR;
  }
}

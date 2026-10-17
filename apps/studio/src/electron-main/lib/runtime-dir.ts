import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * The one folder on this computer for what the app can always rebuild,
 * shared by every workspace on it (`runtimeLayout` names what is inside).
 */
export function getRuntimeDir(): string {
  return path.join(app.getPath("userData"), "runtime");
}

/**
 * Where builds before the runtime folder kept what it holds, at the root of
 * userData: the `bin` links, uv's Pythons and caches, the node tools'
 * caches and config, bubblewrap's closed-file stand-in, and the prepared
 * skills with the copies a crash left beside them.
 */
const FORMER_RUNTIME_ENTRY =
  /^(?:bin|node-tools|sandbox|uv|skills(?:\.(?:preparing|previous)-\d+)?)$/;

/**
 * Deletes what the runtime folder replaced at the root of `userDataDir`.
 * Nothing is carried over, since all of it is made again on use: the
 * managed Python and the caches by downloading them again.
 */
export async function removeFormerRuntime(
  userDataDir = app.getPath("userData"),
): Promise<void> {
  const entries = await fs.readdir(userDataDir).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => FORMER_RUNTIME_ENTRY.test(entry))
      .map((entry) =>
        fs.rm(path.join(userDataDir, entry), { force: true, recursive: true }),
      ),
  );
}

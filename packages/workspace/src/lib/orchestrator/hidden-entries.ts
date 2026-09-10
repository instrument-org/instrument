import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

const NOTHING: ReadonlySet<string> = new Set();

/** How many folders' answers are kept at once. */
const CACHE_MAX = 64;

/** Answers by folder, each good for as long as that folder is unchanged. */
const cache = new Map<string, { names: ReadonlySet<string>; token: number }>();

/**
 * The entries of a folder the system hides, by name.
 *
 * A leading dot is the whole of it on a Mac and on a Linux desktop, and the
 * browser applies that rule to the names it already has. Windows keeps
 * hidden-ness as a file attribute instead: `desktop.ini` sits in every folder a
 * person has ever arranged, and a home folder holds `AppData`, `NTUSER.DAT` and
 * a dozen junctions left for programs written for Windows XP. Explorer shows
 * none of them, and nothing in Node can read the attribute, so `dir` is asked,
 * which answers from the same bits Explorer reads.
 *
 * The answer is cached against the folder's own modified time, since the
 * browser re-reads an open folder every few seconds and asking costs a process.
 * An attribute changed on a file that leaves the folder itself untouched is
 * therefore seen late, at the next change or the next visit.
 */
export async function hiddenEntryNames(
  folder: string,
): Promise<ReadonlySet<string>> {
  if (process.platform !== "win32") {
    return NOTHING;
  }

  const token = await modifiedAt(folder);
  const cached = cache.get(folder);
  if (cached?.token === token) {
    return cached.names;
  }

  const names = await askWindows(folder);
  // Re-inserted rather than updated, so the map's order is last use and the
  // entry dropped below is the one nobody has asked for in longest.
  cache.delete(folder);
  cache.set(folder, { names, token });
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  return names;
}

/**
 * What Windows itself calls hidden in this folder.
 *
 * `/u` is what makes the names readable: without it `cmd` writes them in the
 * console's own code page and anything outside it comes back as a name that
 * matches no file. Verbatim arguments because the path is quoted here and
 * Node's own quoting would nest a second pair inside this one, which `cmd`
 * reads as a malformed path.
 */
async function askWindows(folder: string): Promise<ReadonlySet<string>> {
  try {
    const { stdout } = await run(
      "cmd.exe",
      ["/d", "/u", "/c", `dir /b /a:h "${folder}"`],
      {
        encoding: "buffer",
        windowsHide: true,
        windowsVerbatimArguments: true,
      },
    );
    return new Set(
      stdout
        .toString("utf16le")
        .split(/\r?\n/)
        .map((name) => name.trim())
        .filter(Boolean),
    );
  } catch {
    // A folder with nothing hidden in it is `dir` exiting non-zero with "File
    // Not Found", which is the ordinary answer rather than a failure. A folder
    // that cannot be read at all lands here too, and hiding nothing is the
    // right way to be wrong: the browser shows what it found either way.
    return NOTHING;
  }
}

async function modifiedAt(folder: string): Promise<number> {
  try {
    const stats = await fs.stat(folder);
    return stats.mtimeMs;
  } catch {
    return 0;
  }
}

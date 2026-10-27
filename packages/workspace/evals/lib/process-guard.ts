import { execa } from "execa";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/**
 * What a case's agent starts on this computer, kept to the case: a program
 * that grows past {@link MAX_PROCESS_BYTES} while the case runs is killed
 * (a model-written script once brute-forced billions of combinations and
 * reached 21 GB in two minutes), and whatever is still running in the
 * case's folders when it ends is stopped (a `python -m http.server` from a
 * case was still serving three days later). The agent's commands are left
 * as they run: a limit inside the shell would change what is being measured.
 */

/** Resident memory past which one of a case's programs is killed. */
export const MAX_PROCESS_BYTES = 4 * 1024 ** 3;

interface ProcessRow {
  pid: number;
  ppid: number;
  rssBytes: number;
}

/** Every process on the computer, from `ps`. */
async function processTable(): Promise<ProcessRow[]> {
  const { stdout } = await execa("ps", ["-axo", "pid=,ppid=,rss="], {
    reject: false,
  });
  return stdout.split("\n").flatMap((line) => {
    const [pid, ppid, rss] = line.trim().split(/\s+/u).map(Number);
    return pid === undefined || ppid === undefined || rss === undefined
      ? []
      : Number.isInteger(pid) && Number.isInteger(ppid) && Number.isFinite(rss)
        ? [{ pid, ppid, rssBytes: rss * 1024 }]
        : [];
  });
}

/** The processes under `root` in `table`, its children's children included. */
export function descendantsOf(
  table: readonly ProcessRow[],
  root: number,
): ProcessRow[] {
  const found: ProcessRow[] = [];
  const parents = new Set([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of table) {
      if (parents.has(row.ppid) && !parents.has(row.pid)) {
        parents.add(row.pid);
        found.push(row);
        grew = true;
      }
    }
  }
  return found;
}

/**
 * Whether `cwd` is `dir` or inside it, under either spelling of the folder
 * (`/var/...` and the `/private/var/...` it resolves to on macOS).
 */
export function isInside(cwd: string, dirs: readonly string[]): boolean {
  return dirs.some(
    (dir) => cwd === dir || cwd.startsWith(`${dir.replace(/\/$/u, "")}/`),
  );
}

/** `dirs` with each folder's resolved spelling beside the one given. */
async function spellings(dirs: readonly string[]): Promise<string[]> {
  const resolved = await Promise.all(
    dirs.map((dir) => fs.realpath(dir).catch(() => dir)),
  );
  return [...new Set([...dirs, ...resolved].map((dir) => path.resolve(dir)))];
}

/**
 * Each process's working folder, by pid, for `pids` or for every process:
 * `lsof` on macOS, `/proc` elsewhere.
 */
async function workingFolders(
  pids?: readonly number[],
): Promise<Map<number, string>> {
  const folders = new Map<number, string>();
  if (process.platform === "linux") {
    const ids =
      pids ??
      (await fs.readdir("/proc").catch(() => []))
        .map(Number)
        .filter(Number.isInteger);
    await Promise.all(
      ids.map(async (pid) => {
        const cwd = await fs.readlink(`/proc/${pid}/cwd`).catch(() => null);
        if (cwd !== null) {
          folders.set(pid, cwd);
        }
      }),
    );
    return folders;
  }
  const { stdout } = await execa(
    "lsof",
    [
      "-a",
      "-d",
      "cwd",
      "-Fpn",
      ...(pids === undefined ? [] : ["-p", pids.join(",")]),
    ],
    { reject: false },
  );
  let pid: number | undefined;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("p")) {
      pid = Number(line.slice(1));
    } else if (line.startsWith("n") && pid !== undefined) {
      folders.set(pid, line.slice(1));
    }
  }
  return folders;
}

/**
 * This process's descendants past {@link MAX_PROCESS_BYTES} that work in one
 * of `dirs`, with the memory each holds.
 */
export async function oversizedProcessesIn(
  dirs: readonly string[],
): Promise<{ pid: number; rssBytes: number }[]> {
  const oversized = descendantsOf(await processTable(), process.pid).filter(
    (row) => row.rssBytes > MAX_PROCESS_BYTES,
  );
  if (oversized.length === 0) {
    return [];
  }
  const inside = await spellings(dirs);
  const folders = await workingFolders(oversized.map((row) => row.pid));
  return oversized.filter((row) => {
    const cwd = folders.get(row.pid);
    return cwd !== undefined && isInside(cwd, inside);
  });
}

/**
 * Stops every process working in one of `dirs`, this one and its ancestors
 * aside: asked first, then killed if it has not gone a second later.
 * Returns how many there were.
 */
export async function stopProcessesIn(
  dirs: readonly string[],
): Promise<number> {
  const inside = await spellings(dirs);
  const spared = new Set([process.pid, process.ppid]);
  const pids = [...(await workingFolders()).entries()]
    .filter(([pid, cwd]) => !spared.has(pid) && isInside(cwd, inside))
    .map(([pid]) => pid);
  if (pids.length === 0) {
    return 0;
  }
  signal(pids, "SIGTERM");
  await delay(1000);
  signal(pids, "SIGKILL");
  return pids.length;
}

/** Sends `name` to each of `pids` that is still there. */
export function signal(pids: readonly number[], name: NodeJS.Signals) {
  for (const pid of pids) {
    try {
      process.kill(pid, name);
    } catch {
      // Gone already.
    }
  }
}

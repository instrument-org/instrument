import { execa } from "execa";
import fs from "node:fs/promises";

/** One process as the system lists it: its parent and its process group. */
export interface ProcessRow {
  pgid: number;
  pid: number;
  ppid: number;
}

/**
 * The programs one job started, each the leader of its own process group on
 * macOS and Linux: those still running, and those that have ended. No id for
 * what a session's calls started and left behind without becoming a job.
 */
export interface JobPrograms {
  ended: ReadonlySet<number>;
  id?: string;
  running: ReadonlySet<number>;
}

/**
 * Every process on this computer by pid, read by the app itself, outside any
 * sandbox: `ps` on macOS, `/proc` on Linux. Undefined on Windows, where only
 * the programs a job started itself are known to be its own.
 */
export async function readProcessTable(): Promise<
  Map<number, ProcessRow> | undefined
> {
  if (process.platform === "darwin") {
    const result = await execa("/bin/ps", ["-A", "-o", "pid=,ppid=,pgid="], {
      reject: false,
    });
    return result.exitCode === 0 ? parsePsTable(result.stdout) : undefined;
  }
  if (process.platform === "linux") {
    return await readProcTable();
  }
  return undefined;
}

export function parsePsTable(text: string): Map<number, ProcessRow> {
  const table = new Map<number, ProcessRow>();
  for (const line of text.split("\n")) {
    const [pid, ppid, pgid] = line.trim().split(/\s+/).map(Number);
    if (
      pid !== undefined &&
      ppid !== undefined &&
      pgid !== undefined &&
      [pid, ppid, pgid].every(Number.isInteger)
    ) {
      table.set(pid, { pgid, pid, ppid });
    }
  }
  return table;
}

/**
 * `/proc/<pid>/stat`: the pid, the program's name in parentheses (which can
 * hold spaces and parentheses itself, so the fields resume after the last
 * one), its state, then its parent and its process group.
 */
export function parseProcStat(stat: string): ProcessRow | undefined {
  const close = stat.lastIndexOf(")");
  const pid = Number.parseInt(stat, 10);
  const [, ppid, pgid] = stat
    .slice(close + 1)
    .trim()
    .split(/\s+/)
    .map(Number);
  return close === -1 ||
    !Number.isInteger(pid) ||
    ppid === undefined ||
    pgid === undefined ||
    !Number.isInteger(ppid) ||
    !Number.isInteger(pgid)
    ? undefined
    : { pgid, pid, ppid };
}

async function readProcTable(): Promise<Map<number, ProcessRow>> {
  const table = new Map<number, ProcessRow>();
  const entries = await fs.readdir("/proc").catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => /^\d+$/.test(entry))
      .map(async (entry) => {
        // A process can end between the listing and the read.
        const stat = await fs
          .readFile(`/proc/${entry}/stat`, "utf8")
          .catch(() => undefined);
        const row = stat === undefined ? undefined : parseProcStat(stat);
        if (row) {
          table.set(row.pid, row);
        }
      }),
  );
  return table;
}

/** How far up the parent chain a pid is followed before giving up. */
const MAX_ANCESTORS = 64;

/**
 * The job a pid belongs to: a program it is running, a process in the group
 * one of its programs leads, or a process whose parents lead back to either.
 *
 * A program that has ended keeps its group, since what it left running there
 * is still the job's, but no longer its pid: the system may have given that
 * number to an unrelated process, and while it holds it the old group is
 * gone. Without a table (Windows), only a program a job is running counts.
 */
export function jobOwning(
  pid: number,
  jobs: readonly JobPrograms[],
  table: ReadonlyMap<number, ProcessRow> | undefined,
): JobPrograms | undefined {
  const runningOf = (candidate: number) =>
    jobs.find((job) => job.running.has(candidate));
  const groupOf = (group: number) =>
    runningOf(group) ??
    (table?.has(group) ? undefined : jobs.find((job) => job.ended.has(group)));
  let current = pid;
  for (let step = 0; step < MAX_ANCESTORS; step++) {
    const direct = runningOf(current);
    if (direct) {
      return direct;
    }
    const row = table?.get(current);
    if (!row) {
      return undefined;
    }
    const byGroup = row.pgid > 1 ? groupOf(row.pgid) : undefined;
    if (byGroup) {
      return byGroup;
    }
    if (row.ppid <= 1 || row.ppid === current) {
      return undefined;
    }
    current = row.ppid;
  }
  return undefined;
}

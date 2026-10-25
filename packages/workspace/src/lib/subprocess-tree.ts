import { execa } from "execa";
import ms from "ms";
import { AsyncLocalStorage } from "node:async_hooks";
import { readdirSync, readFileSync } from "node:fs";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";
import { noop } from "radashi";

import { getCurrentDate } from "./get-current-date";
import { parseProcStat } from "./own-processes";

const GRACEFUL_EXIT_MS = ms("1 second");
const FORCE_EXIT_MS = ms("4 seconds");
const POLL_MS = 50;

/**
 * Told when a watched tree starts and when its leader settles. The bash worker
 * reports both to the main thread, which ends the trees still running if the
 * worker dies, since nothing on the worker's side is left to abort them.
 */
export interface SubprocessTreeObserver {
  settled: (pid: number) => void;
  started: (pid: number) => void;
}

export class SubprocessTreeTerminationError extends Error {
  constructor(pid: number) {
    super(`Could not confirm that subprocess tree ${pid} stopped.`);
    this.name = "SubprocessTreeTerminationError";
  }
}

let observer: SubprocessTreeObserver | undefined;

export function setSubprocessTreeObserver(next: SubprocessTreeObserver): void {
  observer = next;
}

/**
 * Told of every tree started beneath it on this thread: how a `bash` run
 * learns the real pids of what it started, so `jobs -l` can show them and
 * `kill` can tell the agent's own processes from the person's. The bash
 * worker reports its trees through the observer instead, and main hands each
 * to the listener of the run it belongs to.
 */
const listeners = new AsyncLocalStorage<SubprocessTreeObserver>();

export function withSubprocessTreeListener<T>(
  listener: SubprocessTreeObserver,
  run: () => T,
): T {
  return listeners.run(listener, run);
}

export function currentSubprocessTreeListener():
  | SubprocessTreeObserver
  | undefined {
  return listeners.getStore();
}

/** Ends a process tree, resolving whether it was confirmed stopped. */
export async function terminateSubprocessTree(pid: number): Promise<boolean> {
  if (process.platform === "win32") {
    const result = await execa("taskkill", ["/pid", String(pid), "/t", "/f"], {
      reject: false,
      windowsHide: true,
    });
    if (result.exitCode === 0) {
      return true;
    }
    // taskkill exits non-zero when the pid is already gone, which is the outcome
    // being asked for. Checked by probing rather than by reading the message,
    // which is localized. Mirrors the POSIX branch treating ESRCH as success.
    return !processExists(pid);
  }

  signalProcessGroup(programGroup(pid), "SIGTERM");
  if (await waitForProcessGroupExit(pid, GRACEFUL_EXIT_MS)) {
    return true;
  }

  if (!signalProcessGroup(pid, "SIGKILL")) {
    return true;
  }
  return await waitForProcessGroupExit(pid, FORCE_EXIT_MS);
}

/**
 * Ends one process with the same escalation and confirmation as a tree, for
 * a pid inside a tree: the rest of the tree is left running.
 */
export async function terminateProcess(pid: number): Promise<boolean> {
  if (process.platform === "win32") {
    return await terminateSubprocessTree(pid);
  }
  if (!signalProcess(pid, "SIGTERM")) {
    return true;
  }
  if (await waitForExit(() => processExists(pid), GRACEFUL_EXIT_MS)) {
    return true;
  }
  if (!signalProcess(pid, "SIGKILL")) {
    return true;
  }
  return await waitForExit(() => processExists(pid), FORCE_EXIT_MS);
}

export function watchSubprocessTree({
  pid,
  signal,
}: {
  pid: number | undefined;
  signal: AbortSignal | undefined;
}) {
  const listener = listeners.getStore();
  if (pid !== undefined) {
    observer?.started(pid);
    listener?.started(pid);
  }
  let termination: Promise<void> | undefined;
  const terminate = () => {
    if (pid === undefined || termination) {
      return;
    }
    termination = terminateSubprocessTree(pid).then((confirmed) => {
      if (!confirmed) {
        throw new SubprocessTreeTerminationError(pid);
      }
    });
    // The only way this rejects is with the tree still alive, which is the one
    // case where the finalizer has not been reached: callers await it after the
    // subprocess settles, and it has not. Observing the rejection here keeps it
    // off the process-wide unhandled-rejection path, where it would surface as
    // an app error; awaiting the same promise below still re-raises it.
    termination.catch(noop);
  };

  signal?.addEventListener("abort", terminate, { once: true });
  if (signal?.aborted) {
    terminate();
  }

  return async () => {
    signal?.removeEventListener("abort", terminate);
    if (pid !== undefined) {
      observer?.settled(pid);
      listener?.settled(pid);
    }
    await termination;
  };
}

/**
 * The process group a signal for the tree `pid` leads is sent to. On Linux a
 * sandboxed program runs under bubblewrap, which stays its parent, passes no
 * signal on, and takes the program down with it when a signal ends it, so a
 * signal sent to bubblewrap never reaches the program as itself. The first
 * process of the sandbox leads the program's own session in there, so the
 * signal goes to that group instead. Anywhere else, and before bubblewrap
 * has made its sandbox, it is the tree's own group.
 */
export function programGroup(pid: number): number {
  if (process.platform !== "linux" || procText(pid, "comm") !== "bwrap") {
    return pid;
  }
  for (const entry of readdirSync("/proc")) {
    const stat = /^\d+$/.test(entry) ? procText(entry, "stat") : undefined;
    const row = stat === undefined ? undefined : parseProcStat(stat);
    if (row && row.ppid === pid && row.pgid === row.pid) {
      return row.pid;
    }
  }
  return pid;
}

/** A `/proc/<pid>/` file, undefined once the process has ended. */
function procText(pid: number | string, file: string): string | undefined {
  try {
    return readFileSync(`/proc/${pid}/${file}`, "utf8").trim();
  } catch {
    return undefined;
  }
}

function isNoSuchProcess(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ESRCH";
}

export function processExists(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isNoSuchProcess(error);
  }
}

function processGroupExists(pid: number) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return !isNoSuchProcess(error);
  }
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): boolean {
  return signalProcess(-pid, signal);
}

/** Sends `signal`, false only when nothing by that id is left to get it. */
function signalProcess(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    if (isNoSuchProcess(error)) {
      return false;
    }
    return true;
  }
}

function waitForProcessGroupExit(pid: number, waitMs: number) {
  return waitForExit(() => processGroupExists(pid), waitMs);
}

async function waitForExit(exists: () => boolean, waitMs: number) {
  const deadline = getCurrentDate().getTime() + waitMs;
  while (exists()) {
    const remaining = deadline - getCurrentDate().getTime();
    if (remaining <= 0) {
      return false;
    }
    await setTimeoutPromise(Math.min(POLL_MS, remaining));
  }
  return true;
}

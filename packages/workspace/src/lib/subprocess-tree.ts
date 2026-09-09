import { execa } from "execa";
import ms from "ms";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";
import { noop } from "radashi";

import { getCurrentDate } from "./get-current-date";

const GRACEFUL_EXIT_MS = ms("1 second");
const FORCE_EXIT_MS = ms("4 seconds");
const POLL_MS = 50;

export class SubprocessTreeTerminationError extends Error {
  constructor(pid: number) {
    super(`Could not confirm that subprocess tree ${pid} stopped.`);
    this.name = "SubprocessTreeTerminationError";
  }
}

export function watchSubprocessTree({
  pid,
  signal,
}: {
  pid: number | undefined;
  signal: AbortSignal | undefined;
}) {
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
    await termination;
  };
}

function isNoSuchProcess(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ESRCH";
}

function processExists(pid: number) {
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
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if (isNoSuchProcess(error)) {
      return false;
    }
    return true;
  }
}

async function terminateSubprocessTree(pid: number): Promise<boolean> {
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

  if (!signalProcessGroup(pid, "SIGTERM")) {
    return true;
  }
  if (await waitForProcessGroupExit(pid, GRACEFUL_EXIT_MS)) {
    return true;
  }

  if (!signalProcessGroup(pid, "SIGKILL")) {
    return true;
  }
  return await waitForProcessGroupExit(pid, FORCE_EXIT_MS);
}

async function waitForProcessGroupExit(pid: number, waitMs: number) {
  const deadline = getCurrentDate().getTime() + waitMs;
  while (processGroupExists(pid)) {
    const remaining = deadline - getCurrentDate().getTime();
    if (remaining <= 0) {
      return false;
    }
    await setTimeoutPromise(Math.min(POLL_MS, remaining));
  }
  return true;
}

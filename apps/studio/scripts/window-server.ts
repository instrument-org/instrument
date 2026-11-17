// Notices macOS starting WindowServer over, for the dev supervisor.
//
// WindowServer can abort (a display reconfiguration is the usual cause) and
// launchd starts a new one at once. macOS relaunches the apps it opened, but a
// dev Electron is the supervisor's grandchild, started from a terminal, so it
// lives on detached from the new WindowServer: no windows, and every system
// service it looks up afterward fails. Some of Apple's frameworks retry such a
// failure in a loop with no pause (AutoFill's view service did, about ten
// thousand times a second), so the supervisor starts the run over instead.

import { execFile } from "node:child_process";

const POLL_MS = 5000;

/**
 * Answers, for each reading of WindowServer's pids, whether it is a new
 * WindowServer: one that differs from the last one seen. A reading of none
 * (between the old one dying and the new one starting, or where WindowServer
 * never runs) changes nothing, so a restart counts once.
 */
export function windowServerRestarts() {
  let seen: string | undefined;
  return (pids: string | undefined) => {
    if (pids === undefined) {
      return false;
    }
    const restarted = seen !== undefined && pids !== seen;
    seen = pids;
    return restarted;
  };
}

/** WindowServer's pids, or undefined when none runs or `pgrep` fails. */
function readWindowServer() {
  return new Promise<string | undefined>((resolve) => {
    execFile("pgrep", ["-x", "WindowServer"], (error, stdout) => {
      const pids = stdout.split("\n").filter(Boolean).sort().join(",");
      resolve(error || !pids ? undefined : pids);
    });
  });
}

/**
 * Calls `onRestart` each time macOS starts a new WindowServer, checking every
 * few seconds. The timer never keeps the process alive.
 */
export function watchWindowServer(onRestart: () => void) {
  const restarted = windowServerRestarts();
  let reading = false;
  const check = async () => {
    if (reading) {
      return;
    }
    reading = true;
    try {
      if (restarted(await readWindowServer())) {
        onRestart();
      }
    } finally {
      reading = false;
    }
  };
  void check();
  setInterval(() => void check(), POLL_MS).unref();
}

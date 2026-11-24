import { execa } from "execa";
import fs from "node:fs/promises";
import path from "node:path";

import { type StoreId } from "../schemas/store-id";
import {
  AGENT_BROWSER_IDLE_TIMEOUT_MS,
  agentBrowserPath,
  AGENT_BROWSER_SOCKET_DIR,
  AGENT_BROWSER_SOCKET_ROOT,
  readSessionName,
} from "./agent-browser";

export async function closeAgentBrowserSessionsForSessions(
  sessionIds: StoreId.Session[],
) {
  const sessionNames = sessionIds.flatMap((sessionId) => [
    sessionId,
    readSessionName(sessionId),
  ]);
  await Promise.all(
    sessionNames.map(async (sessionName) => {
      // `close --session` goes through the CLI's daemon-startup path: with no
      // daemon running it starts one just to close it, and that daemon then
      // idles until its own timeout. A task that only ever had a page open, or
      // never used the external browser, has no daemon for this name.
      if (!(await isDaemonRunning(sessionName))) {
        return;
      }
      // With a daemon running, the invocation must present the configuration
      // the session was started with; otherwise the CLI restarts the daemon
      // and closes the replacement.
      await execa(agentBrowserPath(), ["close", "--session", sessionName], {
        env: { AGENT_BROWSER_IDLE_TIMEOUT_MS, AGENT_BROWSER_SOCKET_DIR },
        reject: false,
      });
    }),
  );
}

/**
 * Whether a daemon for the session is alive, judged the way the CLI's own
 * session discovery judges it: a `<session>.pid` file in the socket dir naming
 * a live process.
 */
async function isDaemonRunning(sessionName: string) {
  const pidFile = await fs
    .readFile(path.join(AGENT_BROWSER_SOCKET_DIR, `${sessionName}.pid`), "utf8")
    .catch(() => null);
  const pid = Number.parseInt(pidFile ?? "", 10);
  return Number.isInteger(pid) && pid > 0 && isProcessRunning(pid);
}

function isProcessRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists under another user.
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

/** Closes every daemon in one app process's socket folder, then removes it. */
async function closeSocketDir(socketDir: string) {
  await execa(agentBrowserPath(), ["close", "--all"], {
    env: { AGENT_BROWSER_SOCKET_DIR: socketDir },
    reject: false,
  });
  await fs.rm(socketDir, { force: true, recursive: true });
}

/** Closes the daemons this process started, and no other app's. */
export async function closeAllAgentBrowserSessions() {
  await closeSocketDir(AGENT_BROWSER_SOCKET_DIR);
}

/**
 * Closes the daemons an app process left behind when it ended without its quit
 * teardown (a crash, a kill). A socket folder is named for its process's pid,
 * and only a folder whose process is gone is touched, so a running app keeps
 * its daemons whatever its age or build. A pid the system has since given to
 * another process reads as running, which leaves the folder for a later launch.
 */
export async function closeAgentBrowserSessionsOfEndedApps() {
  const entries = await fs
    .readdir(AGENT_BROWSER_SOCKET_ROOT, { withFileTypes: true })
    .catch(() => []);
  await Promise.all(
    entries.map(async (entry) => {
      if (
        !entry.isDirectory() ||
        !/^[1-9]\d*$/.test(entry.name) ||
        isProcessRunning(Number(entry.name))
      ) {
        return;
      }
      await closeSocketDir(path.join(AGENT_BROWSER_SOCKET_ROOT, entry.name));
    }),
  );
}

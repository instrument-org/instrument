import { execa } from "execa";
import fs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { AbsolutePathSchema } from "../schemas/paths";
import { type StoreId } from "../schemas/store-id";
import {
  AGENT_BROWSER_IDLE_TIMEOUT_MS,
  AGENT_BROWSER_PATH,
  AGENT_BROWSER_SOCKET_DIR,
  externalBrowserSessionName,
} from "./agent-browser";
import { getExternalBrowserTmpDir } from "./chat-dir-utils";

export async function closeAgentBrowserSessionsForSessions(
  sessionIds: StoreId.Session[],
) {
  const sessionNames = sessionIds.flatMap((sessionId) => [
    sessionId,
    externalBrowserSessionName(sessionId),
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
      await execa(AGENT_BROWSER_PATH, ["close", "--session", sessionName], {
        env: { AGENT_BROWSER_IDLE_TIMEOUT_MS, AGENT_BROWSER_SOCKET_DIR },
        reject: false,
      });
    }),
  );
}

/**
 * Whether a daemon for the session is alive, judged the way the CLI's own
 * session discovery judges it: a `<session>.pid` file in the socket dir naming
 * a live process. On Windows `AGENT_BROWSER_SOCKET_DIR` is unset and the CLI
 * falls back to `~/.agent-browser` (absent an `XDG_RUNTIME_DIR`).
 */
async function isDaemonRunning(sessionName: string) {
  const socketDir =
    AGENT_BROWSER_SOCKET_DIR ?? path.join(homedir(), ".agent-browser");
  const pidFile = await fs
    .readFile(path.join(socketDir, `${sessionName}.pid`), "utf8")
    .catch(() => null);
  const pid = Number.parseInt(pidFile ?? "", 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists under another user.
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

export async function closeAllAgentBrowserSessions() {
  await execa(AGENT_BROWSER_PATH, ["close", "--all"], {
    env: { AGENT_BROWSER_SOCKET_DIR },
    reject: false,
  });
}

/**
 * Empties the workspace's external-browser temp dir. The CLI removes a cloned
 * Chrome profile when the browser it launched exits, and a clean quit closes
 * every session, so what survives here is an orphan from a crash: hundreds of
 * megabytes holding a copy of the user's cookies and browsing history. Call at
 * boot, where the worst case is a daemon that outlived a crash and is minutes
 * from its idle timeout, still holding open handles to files it can lose.
 */
export async function pruneExternalBrowserTmp({
  rootDir,
}: {
  rootDir: string;
}) {
  await fs.rm(getExternalBrowserTmpDir(AbsolutePathSchema.parse(rootDir)), {
    force: true,
    recursive: true,
  });
}

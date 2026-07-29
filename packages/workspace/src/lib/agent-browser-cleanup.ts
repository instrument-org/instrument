import { execa } from "execa";
import fs from "node:fs/promises";

import { AbsolutePathSchema } from "../schemas/paths";
import { type StoreId } from "../schemas/store-id";
import {
  AGENT_BROWSER_IDLE_TIMEOUT_MS,
  AGENT_BROWSER_PATH,
  AGENT_BROWSER_SOCKET_DIR,
  externalBrowserSessionName,
} from "./agent-browser";
import { getExternalBrowserTmpDir } from "./task-dir-utils";

export async function closeAgentBrowserSessionsForSessions(
  sessionIds: StoreId.Session[],
) {
  await Promise.all(
    sessionIds
      .flatMap((sessionId) => [
        sessionId,
        externalBrowserSessionName(sessionId),
      ])
      .map((sessionName) =>
        // `close --session` goes through the CLI's daemon-startup path, so it
        // must present the same daemon configuration the session was started
        // with; otherwise the CLI restarts the daemon and closes the replacement.
        execa(AGENT_BROWSER_PATH, ["close", "--session", sessionName], {
          env: { AGENT_BROWSER_IDLE_TIMEOUT_MS, AGENT_BROWSER_SOCKET_DIR },
          reject: false,
        }),
      ),
  );
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

import { execa } from "execa";

import { type StoreId } from "../schemas/store-id";
import { AGENT_BROWSER_PATH, AGENT_BROWSER_SOCKET_DIR } from "./agent-browser";

export async function closeAgentBrowserSessionsForSessions(
  sessionIds: StoreId.Session[],
) {
  await Promise.all(
    sessionIds.map((sessionId) =>
      execa(AGENT_BROWSER_PATH, ["close", "--session", sessionId], {
        env: { AGENT_BROWSER_SOCKET_DIR },
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

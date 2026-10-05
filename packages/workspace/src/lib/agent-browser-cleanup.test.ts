import { execa } from "execa";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreId } from "../schemas/store-id";
import { closeAgentBrowserSessionsForSessions } from "./agent-browser-cleanup";

const { socketDir } = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const os = await import("node:os");
  const nodePath = await import("node:path");
  return {
    socketDir: mkdtempSync(nodePath.join(os.tmpdir(), "ab-cleanup-")),
  };
});

vi.mock("execa");
vi.mock(import("./agent-browser"), async (importOriginal) => ({
  ...(await importOriginal()),
  AGENT_BROWSER_SOCKET_DIR: socketDir,
}));

// A pid that was alive a moment ago and is not now.
const deadPid = Number(
  execFileSync(
    process.execPath,
    ["-e", "process.stdout.write(String(process.pid))"],
    {
      encoding: "utf8",
    },
  ),
);

async function writePidFile(sessionName: string, pid: number) {
  await fs.writeFile(`${socketDir}/${sessionName}.pid`, String(pid));
}

function closedSessions() {
  return vi
    .mocked(execa)
    .mock.calls.map(([, args]) => (Array.isArray(args) ? args.join(" ") : ""));
}

describe("closeAgentBrowserSessionsForSessions", () => {
  beforeEach(async () => {
    vi.mocked(execa).mockClear();
    await fs.rm(socketDir, { force: true, recursive: true });
    await fs.mkdir(socketDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(socketDir, { force: true, recursive: true });
  });

  it("closes only the sessions whose daemon is alive", async () => {
    const live = StoreId.newSessionId();
    const stale = StoreId.newSessionId();
    const never = StoreId.newSessionId();
    await writePidFile(live, process.pid);
    await writePidFile(`${live}-ext`, deadPid);
    await writePidFile(stale, deadPid);

    await closeAgentBrowserSessionsForSessions([live, stale, never]);

    expect(closedSessions()).toEqual([`close --session ${live}`]);
  });

  it("starts no CLI process when no session has a daemon", async () => {
    await closeAgentBrowserSessionsForSessions([StoreId.newSessionId()]);

    expect(execa).not.toHaveBeenCalled();
  });
});

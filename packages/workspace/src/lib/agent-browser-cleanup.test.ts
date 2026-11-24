import { execa } from "execa";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { StoreId } from "../schemas/store-id";
import {
  closeAgentBrowserSessionsForSessions,
  closeAgentBrowserSessionsOfEndedApps,
  closeAllAgentBrowserSessions,
} from "./agent-browser-cleanup";

const { socketDir, socketRoot } = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const os = await import("node:os");
  const nodePath = await import("node:path");
  const root = mkdtempSync(nodePath.join(os.tmpdir(), "ab-cleanup-"));
  return {
    socketDir: nodePath.join(root, String(process.pid)),
    socketRoot: root,
  };
});

vi.mock("execa");
vi.mock(import("./agent-browser"), async (importOriginal) => ({
  ...(await importOriginal()),
  AGENT_BROWSER_SOCKET_DIR: socketDir,
  AGENT_BROWSER_SOCKET_ROOT: socketRoot,
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

/** The socket folder each `close --all` was pointed at. */
function closedFolders() {
  // Typed as execa's first overload, which takes no arguments list.
  const calls: unknown[][] = vi.mocked(execa).mock.calls;
  return calls.map(([, args, options]) => [
    Array.isArray(args) ? args.join(" ") : "",
    path.relative(
      socketRoot,
      CloseOptionsSchema.parse(options).env.AGENT_BROWSER_SOCKET_DIR,
    ),
  ]);
}

const CloseOptionsSchema = z.object({
  env: z.object({ AGENT_BROWSER_SOCKET_DIR: z.string() }),
});

/** A socket folder with a daemon's files in it, under this name in the root. */
async function writeSocketDir(name: string) {
  const dir = path.join(socketRoot, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${StoreId.newSessionId()}.pid`), "1");
}

async function socketRootEntries() {
  return (await fs.readdir(socketRoot)).toSorted();
}

beforeEach(async () => {
  vi.mocked(execa).mockClear();
  await fs.rm(socketRoot, { force: true, recursive: true });
  await fs.mkdir(socketDir, { recursive: true });
});

afterAll(async () => {
  await fs.rm(socketRoot, { force: true, recursive: true });
});

describe("closeAgentBrowserSessionsForSessions", () => {
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

describe("closeAllAgentBrowserSessions", () => {
  it("closes this process's folder and removes it, and no other app's", async () => {
    await writeSocketDir(String(process.ppid));
    await writeSocketDir(String(deadPid));

    await closeAllAgentBrowserSessions();

    expect(closedFolders()).toEqual([["close --all", String(process.pid)]]);
    expect(await socketRootEntries()).toEqual(
      [String(process.ppid), String(deadPid)].toSorted(),
    );
  });
});

describe("closeAgentBrowserSessionsOfEndedApps", () => {
  it("closes and removes only the folders whose process is gone", async () => {
    // This process and its parent are running apps; the dead pid's crashed.
    await writeSocketDir(String(process.ppid));
    await writeSocketDir(String(deadPid));

    await closeAgentBrowserSessionsOfEndedApps();

    expect(closedFolders()).toEqual([["close --all", String(deadPid)]]);
    expect(await socketRootEntries()).toEqual(
      [String(process.pid), String(process.ppid)].toSorted(),
    );
  });

  it("leaves what is not a pid's folder, however old", async () => {
    // A session's files beside the folders, as a build that kept every app's
    // daemons in one folder left them, which may still be running.
    const session = StoreId.newSessionId();
    await fs.writeFile(path.join(socketRoot, `${session}.pid`), "1");
    await fs.writeFile(path.join(socketRoot, String(deadPid + 1)), "a file");
    await writeSocketDir("0");
    await writeSocketDir("-1");
    await writeSocketDir(`${deadPid}-old`);
    const before = await socketRootEntries();
    const longAgo = new Date("2020-01-01");
    await Promise.all(
      before.map((name) =>
        fs.utimes(path.join(socketRoot, name), longAgo, longAgo),
      ),
    );

    await closeAgentBrowserSessionsOfEndedApps();

    expect(execa).not.toHaveBeenCalled();
    expect(await socketRootEntries()).toEqual(before);
  });

  it("does nothing when no app has started a daemon on this machine", async () => {
    await fs.rm(socketRoot, { force: true, recursive: true });

    await closeAgentBrowserSessionsOfEndedApps();

    expect(execa).not.toHaveBeenCalled();
  });
});

import { getWorkspaceFolder } from "@/electron-main/lib/get-workspace-folder";
import { is } from "@electron-toolkit/utils";
import { session, type Session } from "electron";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { registerAppProtocol } from "./app-protocol";
import { logger } from "./electron-logger";
import { appSessionDirOf } from "./settings-migration";
import { applyStandardUserAgent } from "./user-agent";

/**
 * What every session that draws the app's own windows needs: the standard user
 * agent for the app's remote requests (avatars, embedded remote images), the
 * permission policy, and the `app:` protocol.
 */
export function configureAppSession(ses: Session): void {
  // Present the identity of an ordinary Chromium-derived browser, with matching
  // client hints, for compatibility with services that respond differently to
  // the Electron UA.
  applyStandardUserAgent(ses);

  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    // Disable fullscreen API for things like video players
    callback(permission !== "fullscreen");
  });

  registerAppProtocol(ses);
}

let appSession: null | Session = null;

/**
 * The Chromium profile the app and onboarding windows run on, inside the
 * workspace: its localStorage holds the window's tabs, drafts, bookmarks and
 * history, all of which point at this workspace's chats and pages, so two
 * workspaces never see each other's. The in-app browser has a profile of its
 * own beside it (`browser-session`).
 */
export function getAppSession(): Session {
  if (appSession === null) {
    const dir = appSessionDirOf(getWorkspaceFolder());
    fs.mkdirSync(dir, { recursive: true });
    appSession = session.fromPath(dir);
    configureAppSession(appSession);
  }
  return appSession;
}

/** Longer than the quit teardown, so only a predecessor that is stuck is outwaited. */
const PREVIOUS_DEV_INSTANCE_WAIT_MS = 30_000;

/**
 * Under `pnpm dev`, a main-process rebuild kills Electron and starts the next
 * one at once, while the old one is still in its quit teardown holding this
 * profile. Chromium gives a second process on a held profile an in-memory
 * localStorage, so the new window would open on the default tab and nothing it
 * saved would reach disk. So a dev instance waits for the one it replaces: the
 * process last recorded on the profile, when it has the same parent (the same
 * electron-vite). An instance from another checkout on the same workspace is
 * not waited for; the two cannot share the profile either way.
 */
export async function waitForPreviousDevInstance(): Promise<void> {
  if (!is.dev) {
    return;
  }
  const dir = appSessionDirOf(getWorkspaceFolder());
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "dev-instance.json");
  const previous = readDevInstance(file);
  if (previous && previous.pid !== process.pid) {
    if (previous.ppid === process.ppid) {
      const deadline = Date.now() + PREVIOUS_DEV_INSTANCE_WAIT_MS;
      while (isAlive(previous.pid) && Date.now() < deadline) {
        await sleep(100);
      }
    } else if (isAlive(previous.pid)) {
      logger.warn(
        `Another dev instance (pid ${previous.pid}) holds this workspace's app session; this window's localStorage will not persist.`,
      );
    }
  }
  fs.writeFileSync(
    file,
    JSON.stringify({ pid: process.pid, ppid: process.ppid }),
  );
}

function readDevInstance(
  file: string,
): undefined | { pid: number; ppid: number } {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      typeof value === "object" &&
      value !== null &&
      "pid" in value &&
      "ppid" in value &&
      typeof value.pid === "number" &&
      typeof value.ppid === "number"
    ) {
      return { pid: value.pid, ppid: value.ppid };
    }
  } catch {
    // No record yet, or one cut short: nothing to wait for.
  }
  return undefined;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: alive, just not ours to signal.
    return (
      error instanceof Error && "code" in error && error.code === "EPERM"
    );
  }
}

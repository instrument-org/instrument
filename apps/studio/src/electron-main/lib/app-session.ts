import { getWorkspaceFolder } from "@/electron-main/lib/get-workspace-folder";
import { session, type Session } from "electron";
import fs from "node:fs";

import { registerAppProtocol } from "./app-protocol";
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

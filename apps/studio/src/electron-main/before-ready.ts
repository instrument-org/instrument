/// <reference types="electron-vite/node" />

// What the main process does before Electron is ready, which `boot.ts` awaits:
// the environment and userData, the crash diagnostics, the single-instance
// lock, the schemes the windows load from, and catching what the launch is
// handed. Then, from what this has loaded, the first window comes up
// (`windows/early-window.ts`) before the rest of main (`index.ts`) loads.
import "@/electron-main/thread-pool"; // Before anything starts the pool
import "@/electron-main/setup-environment"; // This must be imported next
import { is } from "@electron-toolkit/utils";
import { APP_BUNDLE_ID, APP_PROTOCOL } from "@instrument-org/shared";
import { app, protocol } from "electron";

import { catchHandOvers } from "./lib/launch-hand-overs";
import { quitsWithLastWindow } from "./lib/quit";
import { registerCrashDiagnostics } from "./lib/register-crash-diagnostics";

export { handleBootFailure } from "./lib/handle-boot-failure";
export { showEarlyWindow } from "./windows/early-window";

/**
 * Whether this process runs the app. Dev skips the single-instance lock so
 * multiple worktrees can boot side by side. Packaged builds keep it so second
 * launches (deep links) forward to the running instance.
 */
export const gotTheLock = is.dev || app.requestSingleInstanceLock();

if (gotTheLock) {
  protocol.registerSchemesAsPrivileged([
    {
      privileges: {
        // The built renderer is served from this scheme (`app-protocol.ts`),
        // and Chromium keeps V8's compiled code for a custom scheme's scripts
        // only when it opts in. Development loads from the dev server.
        codeCache: true,
        // The renderer's origin is one host of this scheme, so the document
        // viewers fetching their WASM from another is a cross-origin request.
        // Chromium rejects those for custom schemes unless the scheme itself
        // opts in, regardless of the response's CORS headers.
        corsEnabled: true,
        secure: true,
        standard: true,
        supportFetchAPI: true,
      },
      scheme: APP_PROTOCOL,
    },
    {
      // The browser extensions' action icons, which the window draws over
      // this scheme (`browser-view/extensions.ts`). The one call to this
      // method names every scheme, so the library's own registration of it
      // is repeated here.
      privileges: { bypassCSP: true, secure: true },
      scheme: "crx",
    },
  ]);

  // Windows attributes toasts and taskbar buttons by the process's
  // AppUserModelID, and shows a toast only for one a Start menu shortcut
  // carries. The installer stamps the build's appId on its shortcuts, each
  // preview's its own, so the running app takes the same, before its first
  // window.
  if (process.platform === "win32" && app.isPackaged) {
    app.setAppUserModelId(APP_BUNDLE_ID);
  }

  registerCrashDiagnostics(app);

  catchHandOvers();

  // Closing the last window quits outside macOS, where the window's own close
  // handler has already asked about running work. On macOS the app stays in
  // the Dock with its work going, and Cmd+Q asks. Listened for before the
  // first window is up, which Electron would otherwise quit with on close.
  app.on("window-all-closed", () => {
    if (quitsWithLastWindow) {
      app.quit();
    }
  });
}

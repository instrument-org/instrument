/// <reference types="electron-vite/node" />

// The main process's entry. It turns on Node's compile cache and then loads the
// app, so the cache covers the app's own bundle: what has to come before
// `ready`, the first window, then the rest. Whatever this file imports
// statically loads before the cache is on, so it imports nothing of the app's
// but the launch's clock.
import { app } from "electron";
import module from "node:module";
import path from "node:path";

import { noteReady } from "./lib/launch-clock";

enableCompileCache();
void app.whenReady().then(noteReady);

// Velopack starts the Windows app to run its install and update hooks, which
// end the process; they are answered before anything of the app loads.
if (process.platform === "win32") {
  const { answerVelopackLaunch } = await import("./lib/velopack");
  answerVelopackLaunch();
}

// Awaited at the top level, since Electron holds `ready` until it is done:
// what has to happen before `ready` happens there.
const { gotTheLock, handleBootFailure, showEarlyWindow } =
  await import("./before-ready");

if (gotTheLock) {
  // The first window comes up as soon as Electron is ready, and the rest of
  // the app loads after it. Loading it before `ready` would hold `ready`
  // back by as long as it takes.
  void app
    .whenReady()
    .then(async () => {
      try {
        showEarlyWindow();
      } catch (error) {
        // It comes up with the others instead.
        console.error("Could not show the first window early", error);
      }
      await import("./index");
    })
    .catch(handleBootFailure);
} else {
  // A lock loser has no application state to tear down. Exit synchronously
  // so quit handlers cannot keep it alive long enough to enter primary
  // startup.
  app.exit(0);
}

/**
 * Keeps V8's compiled code for the main process's modules between launches,
 * in `Compile Cache` under the app's userData, flushed a few seconds into
 * the launch (`index.ts`) and again by Node at exit. The folder is read
 * before `setup-environment` settles userData, which a packaged build's
 * default already is, short of the `ELECTRON_USER_DATA_DIR` override that
 * file also honors.
 *
 * Not in development, where the bundle changes with every edit and userData
 * is not yet the dev folder. Not under an AppImage either, which mounts the
 * app at a new path every launch while Node keys its entries by path. Set in
 * code rather than through `NODE_COMPILE_CACHE`, which every command the
 * agent runs with this binary as `node` would inherit.
 */
function enableCompileCache() {
  if (import.meta.env.DEV || process.env.APPIMAGE) {
    return;
  }
  try {
    module.enableCompileCache(
      path.join(
        process.env.ELECTRON_USER_DATA_DIR ?? app.getPath("userData"),
        "Compile Cache",
      ),
    );
  } catch {
    // A launch without the cache is only slower.
  }
}

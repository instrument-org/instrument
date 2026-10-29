/// <reference types="electron-vite/node" />

// The main process's entry. It turns on Node's compile cache and then loads the
// app, so the cache covers the app's own bundle. Whatever this file imports
// statically loads before the cache is on, so it imports nothing of the app's.
import { app } from "electron";
import module from "node:module";
import path from "node:path";

enableCompileCache();

// Velopack starts the Windows app to run its install and update hooks, which
// end the process; they are answered before anything of the app loads.
if (process.platform === "win32") {
  const { answerVelopackLaunch } = await import("./lib/velopack");
  answerVelopackLaunch();
}

// Awaited at the top level, so the app registers its schemes before `ready`.
await import("./index");

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

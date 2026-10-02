// Runs `electron-vite` and starts it again when the app asks to be restarted.
//
// The app restarts itself to switch workspaces. A packaged build does that with
// `app.relaunch()`, but under `electron-vite dev` the Electron process is
// electron-vite's child, and electron-vite exits as soon as that child does,
// taking the renderer's dev server with it. So in dev the app exits with
// RELAUNCH_EXIT_CODE instead (see src/electron-main/lib/relaunch.ts), and this
// starts electron-vite over again with the same arguments and environment.
// Every other exit is passed through as it is.
//
//   node scripts/dev-supervisor.ts dev --sourcemap
//
// The `dev` script and studio-drive's `boot` both run electron-vite through
// this, so the process a launcher holds keeps the same pid across a restart.

import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";

// Kept in step with DEV_RELAUNCH_EXIT_CODE in src/electron-main/lib/relaunch.ts.
const RELAUNCH_EXIT_CODE = 75;

// The bin shim rather than electron-vite's .js entry, because the shim is what
// exports the NODE_PATH into .pnpm that the config's `require.resolve` of
// ffmpeg-static and friends resolves through.
const ELECTRON_VITE = path.resolve(
  import.meta.dirname,
  "../node_modules/.bin",
  process.platform === "win32" ? "electron-vite.cmd" : "electron-vite",
);

let child: ChildProcess | undefined;
let stopping = false;

function start() {
  child = spawn(ELECTRON_VITE, process.argv.slice(2), {
    env: { ...process.env, INSTRUMENT_DEV_SUPERVISOR: "1" },
    // A .cmd shim only runs through a shell.
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  child.on("exit", (code, signal) => {
    if (!stopping && code === RELAUNCH_EXIT_CODE) {
      process.stdout.write("\n[dev-supervisor] restarting electron-vite\n\n");
      start();
      return;
    }
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    stopping = true;
    child?.kill(signal);
  });
}

start();

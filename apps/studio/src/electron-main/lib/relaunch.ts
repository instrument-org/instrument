import { app } from "electron";
import { spawn } from "node:child_process";

import { requestQuitApproval } from "./quit";

/**
 * The exit code that asks `scripts/dev-supervisor.ts` to start electron-vite
 * again. A dev build cannot use `app.relaunch()`: electron-vite exits when its
 * Electron child does, taking the renderer dev server with it, so a relaunched
 * child would load a URL nothing serves. Kept in step with the supervisor.
 */
const DEV_RELAUNCH_EXIT_CODE = 75;

let exitCode = 0;

/**
 * Whether this run can bring itself back after quitting: every packaged
 * build, and a dev build only under the supervisor, not one a debugger's
 * launch config started by running electron-vite directly.
 */
export function canRelaunch(): boolean {
  return app.isPackaged || process.env.INSTRUMENT_DEV_SUPERVISOR === "1";
}

/** What the quit teardown passes to `app.exit` once it has finished. */
export function quitExitCode(): number {
  return exitCode;
}

/**
 * Quit through the usual teardown and come back up. Asks about running agents
 * first, exactly as closing the window does; `beforeRestart` runs only once
 * that is approved, so a declined prompt changes nothing.
 */
export async function relaunchApp({
  beforeRestart,
}: {
  beforeRestart: () => void;
}): Promise<"canceled" | "relaunching"> {
  if (!(await requestQuitApproval())) {
    return "canceled";
  }
  beforeRestart();
  if (app.isPackaged) {
    startAgainOnExit();
  } else {
    exitCode = DEV_RELAUNCH_EXIT_CODE;
  }
  app.quit();
  return "relaunching";
}

/**
 * Exit and come back up at once, for a window shown before anything opened
 * (`workspace-refusal.ts`): there is nothing running to ask about or tear
 * down. Answers false, having done nothing, for a run that cannot bring
 * itself back.
 */
export function restartNow(): boolean {
  if (!canRelaunch()) {
    return false;
  }
  if (app.isPackaged) {
    startAgainOnExit();
    app.exit(0);
  } else {
    app.exit(DEV_RELAUNCH_EXIT_CODE);
  }
  return true;
}

/**
 * Start the app again, with the arguments it was started with, once this
 * process has exited.
 *
 * On Linux that is a shell of its own rather than `app.relaunch()`, which
 * starts its helper with no-new-privileges set, inherited by everything the
 * helper starts (electron/electron#41463). Under it a setuid program runs
 * without its privileges: a build whose Chromium sandbox is the setuid
 * `chrome-sandbox` (the tar.gz, and the rpm where unprivileged user
 * namespaces are off) dies at startup, and a Debian install loses the
 * `pkexec` its updates authenticate with. A process Node starts inherits
 * nothing of the kind.
 */
function startAgainOnExit() {
  if (process.platform !== "linux") {
    app.relaunch();
    return;
  }
  // An AppImage runs from a mount that goes away when it exits, so it starts
  // again from the image.
  const executable = process.env.APPIMAGE ?? process.execPath;
  spawn(
    "/bin/sh",
    [
      "-c",
      'while kill -0 "$0" 2>/dev/null; do sleep 0.1; done; exec "$@"',
      String(process.pid),
      executable,
      ...process.argv.slice(1),
    ],
    { detached: true, stdio: "ignore" },
  ).unref();
}

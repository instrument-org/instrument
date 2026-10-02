import { app } from "electron";

import { requestQuitApproval } from "./quit-guard";
import { installedFromDeb } from "./update";

/**
 * The exit code that asks `scripts/dev-supervisor.ts` to start electron-vite
 * again. A dev build cannot use `app.relaunch()`: electron-vite exits when its
 * Electron child does, taking the renderer dev server with it, so a relaunched
 * child would load a URL nothing serves. Kept in step with the supervisor.
 */
const DEV_RELAUNCH_EXIT_CODE = 75;

let exitCode = 0;

/**
 * Whether this run can bring itself back after quitting. Not a dev build
 * started without the supervisor (a debugger's launch config running
 * electron-vite directly), and not a Debian install: `app.relaunch()` there
 * strips the privileges later updates authenticate with (see `update.ts`).
 */
export function canRelaunch(): boolean {
  if (!app.isPackaged) {
    return process.env.INSTRUMENT_DEV_SUPERVISOR === "1";
  }
  return !installedFromDeb();
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
    app.relaunch();
  } else {
    exitCode = DEV_RELAUNCH_EXIT_CODE;
  }
  app.quit();
  return "relaunching";
}

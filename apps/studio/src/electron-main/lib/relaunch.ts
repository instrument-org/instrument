import { app } from "electron";

import { requestQuitApproval } from "./quit-guard";

/**
 * The exit code that asks `scripts/dev-supervisor.mjs` to start electron-vite
 * again. A dev build cannot use `app.relaunch()`: electron-vite exits when its
 * Electron child does, taking the renderer dev server with it, so a relaunched
 * child would load a URL nothing serves. Kept in step with the supervisor.
 */
const DEV_RELAUNCH_EXIT_CODE = 75;

let exitCode = 0;

/** What the quit teardown passes to `app.exit` once it has finished. */
export function quitExitCode(): number {
  return exitCode;
}

/**
 * Quit through the usual teardown and come back up. Asks about running agents
 * first, exactly as closing the window does, and gives up if that is declined.
 *
 * `unsupported` is a dev build started without the supervisor (a debugger's
 * launch config running electron-vite directly), which can quit but has
 * nothing to bring it back.
 */
export async function relaunchApp(): Promise<
  "canceled" | "relaunching" | "unsupported"
> {
  const canRelaunch =
    app.isPackaged || process.env.INSTRUMENT_DEV_SUPERVISOR === "1";
  if (!canRelaunch) {
    return "unsupported";
  }
  if (!(await requestQuitApproval())) {
    return "canceled";
  }
  if (app.isPackaged) {
    app.relaunch();
  } else {
    exitCode = DEV_RELAUNCH_EXIT_CODE;
  }
  app.quit();
  return "relaunching";
}

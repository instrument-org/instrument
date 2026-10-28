import { app } from "electron";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

import { requestQuitApproval } from "./quit";
import { deferInstallOnQuit } from "./update";

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
  startAgainAfterQuit();
  app.quit();
  return "relaunching";
}

/**
 * Have the quit that follows come back up, for a caller that has approved
 * the quit itself.
 */
export function startAgainAfterQuit() {
  if (app.isPackaged) {
    startAgainOnExit();
  } else {
    exitCode = DEV_RELAUNCH_EXIT_CODE;
  }
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
 *
 * It does inherit every file this process holds open without close-on-exec,
 * which Chromium leaves on many (its caches, locks, sockets, the debug
 * port), and would hand them all to the app it starts, a generation more on
 * each restart. Where there is a bash, the shell closes everything above
 * standard error first; `sh` (dash) can only name a file below 10, so
 * without bash they pass through.
 */
function startAgainOnExit() {
  if (process.platform !== "linux") {
    app.relaunch();
    return;
  }
  // The AppImage install on quit removes the image and may move the update
  // to a versioned name, which would leave the restart nothing to start, so
  // a staged update waits for a later quit.
  if (process.env.APPIMAGE) {
    deferInstallOnQuit();
  }
  const { args, file } = restartCommand({
    argv: process.argv.slice(1),
    bash: existsSync("/bin/bash"),
    // An AppImage runs from a mount that goes away when it exits, so it
    // starts again from the image.
    executable: process.env.APPIMAGE ?? process.execPath,
    pid: process.pid,
  });
  spawn(file, args, { detached: true, stdio: "ignore" }).unref();
}

/**
 * The shell that waits for `pid` to exit and then becomes `executable` with
 * `argv`. Its one program found by name, `sleep`, is looked for on the
 * system's own PATH (`command -p`), not the app's, whose first folder is the
 * runtime folder's `bin/`; `kill` is the shell's own. The PATH it inherits
 * is left as it is, since the app it starts inherits it in turn.
 */
export function restartCommand({
  argv,
  bash,
  executable,
  pid,
}: {
  argv: readonly string[];
  /** Whether there is a `/bin/bash`, which can close every inherited file. */
  bash: boolean;
  executable: string;
  pid: number;
}): { args: string[]; file: string } {
  const closeInherited = bash
    ? 'for fd in /proc/$$/fd/*; do n=${fd##*/}; [ "$n" -gt 2 ] 2>/dev/null && eval "exec $n>&-" 2>/dev/null; done; '
    : "";
  return {
    args: [
      "-c",
      `${closeInherited}while kill -0 "$0" 2>/dev/null; do command -p sleep 0.1; done; exec "$@"`,
      String(pid),
      executable,
      ...argv,
    ],
    file: bash ? "/bin/bash" : "/bin/sh",
  };
}

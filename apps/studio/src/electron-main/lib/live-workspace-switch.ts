import { platformApiQueryClient } from "@/electron-main/platform-api/client";
import { publisher } from "@/electron-main/rpc/publisher";
import {
  closeAppWindowForSwitch,
  openAppWindow,
} from "@/electron-main/windows/app-window";
import { app } from "electron";
import { noop } from "radashi";

import { captureServerException } from "./capture-server-exception";
import { logger } from "./electron-logger";
import { openWorkspace, releaseWorkspaceOpenMark } from "./open-workspace";
import { requestQuitApproval, withdrawQuitApproval } from "./quit";
import { canRelaunch, relaunchApp } from "./relaunch";
import { runningWorkspace, setRunningWorkspace } from "./running-workspace";
import { refreshSetupFacts } from "./setup-facts";
import { startWorkspace } from "./start-workspace";
import { getResolvedWorkspace } from "./workspaces";
import { currentWorkspaceScope, openWorkspaceScope } from "./workspace-scope";

const log = logger.scope("workspace-switch");

/** Whether a switch is under way, which a second one waits out by being turned down. */
let switching = false;

/**
 * Whether a switch closes this workspace and opens the next in this process.
 * `INSTRUMENT_LIVE_WORKSPACE_SWITCH=0` keeps the restart, for comparing the
 * two or getting past a switch that goes wrong.
 */
export function switchesLive(): boolean {
  return process.env.INSTRUMENT_LIVE_WORKSPACE_SWITCH !== "0";
}

/**
 * Opens the workspace `choose` records (the registry's active entry, a
 * pending move) in place of the one open now, in this process. Asks about
 * running agents first, as a restart does: declined, `choose` never runs
 * and the answer is `canceled`. Approved, `choose` runs and the answer is
 * `switching`, before the window that asked goes; the switch itself runs
 * after (`live-workspace-switch.md`), and anything in it that fails restarts
 * the app instead, whose next launch opens what `choose` recorded.
 *
 * With live switching off, this is the restart (`relaunchApp`).
 */
export async function switchWorkspace({
  choose,
}: {
  choose: () => void;
}): Promise<"canceled" | "relaunching" | "switching"> {
  if (!switchesLive()) {
    return relaunchApp({ beforeRestart: choose });
  }
  if (switching) {
    return "canceled";
  }
  if (!(await requestQuitApproval())) {
    return "canceled";
  }
  // The approval was for this switch; a later quit asks again.
  withdrawQuitApproval();
  switching = true;
  try {
    choose();
  } catch (error) {
    switching = false;
    throw error;
  }
  setTimeout(() => {
    void runSwitch().finally(() => {
      switching = false;
    });
  });
  return "switching";
}

/** The switch after the choice is recorded: close this workspace, open the next, open its window. */
async function runSwitch() {
  const from = getResolvedWorkspace();
  const startedAt = performance.now();
  const step = (what: string) => {
    log.info(
      `${what} (${Math.round(performance.now() - startedAt).toString()}ms)`,
    );
  };
  try {
    log.info(`Closing ${from.id} at ${from.path}`);
    await closeAppWindowForSwitch();
    step("Closed the window");
    const running = runningWorkspace();
    setRunningWorkspace(undefined);
    await running?.close();
    step("Closed the workspace");
    await currentWorkspaceScope().close(captureServerException);
    releaseWorkspaceOpenMark();
    openWorkspaceScope();
    // The sign-in these answered for is the closed workspace's.
    platformApiQueryClient.clear();
    step("Closed its stores");

    const opened = openWorkspace({ atLaunch: false });
    if (opened.kind === "refused") {
      log.warn(`Not opening the next workspace (${opened.refusal.kind})`);
      fallBack();
      return;
    }
    const to = getResolvedWorkspace();
    step(`Settled ${to.id} at ${to.path}`);
    await startWorkspace();
    step("Started the workspace");
    // What reads the sign-in, setup's plan fact among them, reads it again.
    publisher.publish("session.apiBearerToken.updated", null);
    refreshSetupFacts();
    openAppWindow();
    step(`Opened ${to.id} in process ${process.pid.toString()}`);
  } catch (error) {
    log.error("The switch failed; restarting instead", error);
    captureServerException(error);
    fallBack();
  }
}

/**
 * Restarts the app, whose next launch opens what the switch recorded. Agents
 * are stopped by now, so the restart asks nothing. A build that cannot
 * restart itself quits, and opens it when started again.
 */
function fallBack() {
  if (!canRelaunch()) {
    log.warn("This run cannot restart itself; quitting");
    app.quit();
    return;
  }
  void relaunchApp({ beforeRestart: noop });
}

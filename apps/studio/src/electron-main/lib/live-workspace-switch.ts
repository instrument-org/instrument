import { cancelSignInSocial } from "@/electron-main/auth/client";
import { platformApiQueryClient } from "@/electron-main/platform-api/client";
import { publisher } from "@/electron-main/rpc/publisher";
import {
  closeAppWindowForSwitch,
  openAppWindowAfterSwitch,
} from "@/electron-main/windows/app-window";
import { BACKGROUND_PROCESS_TEARDOWN_MS } from "@instrument-org/workspace/electron";
import { app } from "electron";
import ms from "ms";
import { noop } from "radashi";

import { closeCompletionNotifications } from "./agent-completion-notifications";
import { captureServerException } from "./capture-server-exception";
import {
  cancelClaudeSignIn,
  forgetClaudeAccountReading,
} from "./claude-account";
import { cancelOpenRouterConnect } from "./openrouter-connect";
import { logger } from "./electron-logger";
import { openWorkspace, releaseWorkspaceOpenMark } from "./open-workspace";
import {
  isQuitUnderway,
  requestQuitApproval,
  withdrawQuitApproval,
} from "./quit";
import { BROWSER_SESSIONS_CLOSE_MS } from "./quit-machine";
import { canRelaunch, relaunchApp } from "./relaunch";
import {
  noteWorkspaceSwitch,
  runningWorkspace,
  setRunningWorkspace,
} from "./running-workspace";
import { refreshSetupFacts } from "./setup-facts";
import { startWorkspace } from "./start-workspace";
import { getResolvedWorkspace } from "./workspaces";
import { currentWorkspaceScope, openWorkspaceScope } from "./workspace-scope";

const log = logger.scope("workspace-switch");

/** Whether a switch is under way, which a second one waits out by being turned down. */
let switching = false;

/**
 * Whether a switch is under way: its window closing is not the last
 * window's, which outside macOS would quit the app.
 */
export function isSwitchingWorkspace(): boolean {
  return switching;
}

/**
 * Whether a switch closes this workspace and opens the next in this process.
 * `INSTRUMENT_LIVE_WORKSPACE_SWITCH=0` keeps the restart, for comparing the
 * two or getting past a switch that goes wrong; `fail` makes a development
 * build's switch fail once the workspace has closed, which restarts it.
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
  // A quit on its way out tears the workspace down itself.
  if (switching || isQuitUnderway()) {
    return "canceled";
  }
  // Before the question, so a second switch asked while it is open is
  // turned down rather than asking again.
  switching = true;
  if (!(await requestQuitApproval())) {
    switching = false;
    return "canceled";
  }
  // A quit asked for while the question was open shared its answer, and
  // goes ahead without the switch.
  if (isQuitUnderway()) {
    switching = false;
    return "canceled";
  }
  // The approval was for this switch; a later quit asks again.
  withdrawQuitApproval();
  try {
    choose();
  } catch (error) {
    switching = false;
    throw error;
  }
  let started: () => void = noop;
  noteWorkspaceSwitch(
    new Promise<void>((resolve) => {
      started = resolve;
    }).then(() =>
      runSwitch().finally(() => {
        switching = false;
      }),
    ),
  );
  setTimeout(started);
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
    // A sign-in still waiting on the browser is the closing workspace's.
    // ChatGPT's and Grok's end with its scope.
    cancelSignInSocial();
    cancelOpenRouterConnect();
    cancelClaudeSignIn();
    // A notification of the closing workspace's names a chat the next one
    // does not have.
    closeCompletionNotifications();
    await closeAppWindowForSwitch();
    step("Closed the window");
    // Running until it has closed, so a quit that comes meanwhile and waits
    // for the switch reads it as gone only once it is.
    const running = runningWorkspace();
    await withDeadline(running?.close(), CLOSE_DEADLINE_MS);
    setRunningWorkspace(undefined);
    step("Closed the workspace");
    await currentWorkspaceScope().close(captureServerException);
    forgetClaudeAccountReading();
    releaseWorkspaceOpenMark();
    openWorkspaceScope();
    // The sign-in these answered for is the closed workspace's.
    platformApiQueryClient.clear();
    step("Closed its stores");
    // A development build can be told to fail here, to exercise the fallback.
    if (
      !app.isPackaged &&
      process.env.INSTRUMENT_LIVE_WORKSPACE_SWITCH === "fail"
    ) {
      throw new Error(
        "Failing the switch, as INSTRUMENT_LIVE_WORKSPACE_SWITCH asks",
      );
    }

    // A quit asked for while the workspace closed ends the app here; its
    // next launch opens what the switch recorded.
    if (isQuitUnderway()) {
      log.info(
        "A quit came while closing; leaving the next workspace to the next launch",
      );
      return;
    }
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
    openAppWindowAfterSwitch();
    step(`Opened ${to.id} in process ${process.pid.toString()}`);
  } catch (error) {
    log.error("The switch failed; restarting instead", error);
    captureServerException(error);
    fallBack();
  }
}

/**
 * How long closing the workspace may take: its sessions' stop (10 seconds,
 * `closeWorkspace`), the agent-browser sessions and the background processes
 * as the quit bounds them, and slack. Past it the switch restarts the app.
 */
const CLOSE_DEADLINE_MS =
  ms("10 seconds") +
  BROWSER_SESSIONS_CLOSE_MS +
  BACKGROUND_PROCESS_TEARDOWN_MS +
  ms("5 seconds");

/** `work`, or a rejection once `deadlineMs` passes without it settling. */
async function withDeadline(
  work: Promise<void> | undefined,
  deadlineMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(`Closing the workspace took over ${ms(deadlineMs)}`),
          );
        }, deadlineMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
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

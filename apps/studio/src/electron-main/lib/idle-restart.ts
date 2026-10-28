import { app, BrowserWindow, powerMonitor } from "electron";

import {
  readAutomaticRestart,
  recordAutomaticInstall,
} from "../stores/machine/state";
import { getAppWindow } from "../windows/app-window";
import { readCaptureInUse } from "./capture-in-use";
import { type AppUpdaterHandle } from "./create-app-updater";
import { logger } from "./electron-logger";
import {
  type IdleRestartFacts,
  type IdleRestartState,
  type IdleRestartTimings,
  type IdleRestartVerdict,
  type RelaunchView,
  stepIdleRestart,
} from "./idle-restart-policy";
import {
  approveQuitQuietly,
  readRunningWork,
  withdrawQuitApproval,
} from "./quit";

const log = logger.scope("idleRestart");

/**
 * Restarts the app to install a staged update while no one is using it
 * (`idle-restart-policy.ts` decides when). It reads the facts every
 * `recheckMs` while it runs, and a window taking focus starts the backstop's
 * wait over at once.
 *
 * The restart goes through the updater's own install, in its automatic mode:
 * the same latch, pre-install check and wait for a superseding download as
 * a click, with this module's last look in place of the quit prompt.
 */
export function startIdleRestart({
  installable,
  timings,
  updater,
}: {
  // Whether the staged update can be handed to the installer this moment.
  installable: () => boolean;
  timings: IdleRestartTimings;
  updater: AppUpdaterHandle;
}) {
  let state: IdleRestartState = {
    noWindowSince: undefined,
    quietSince: undefined,
  };
  // Bumped by every focus, so a reading taken before one cannot restart the
  // countdown it reset.
  let focuses = 0;
  let restarting = false;
  let lastSaid = "";
  // When the screen locked, by the system's own event; a lock this process
  // started under has none, so the first reading that sees it stands in.
  let lockedAt: number | undefined;
  let lockSeenAt: number | undefined;

  app.on("browser-window-focus", () => {
    focuses += 1;
    state = { ...state, quietSince: undefined };
  });
  powerMonitor.on("lock-screen", () => {
    lockedAt = Date.now();
  });
  powerMonitor.on("unlock-screen", () => {
    lockedAt = undefined;
  });

  // Locked since when, or undefined; the event is believed only while the
  // system also reports the screen locked.
  const readLockedSince = (now: number) => {
    if (powerMonitor.getSystemIdleState(1) !== "locked") {
      lockSeenAt = undefined;
      return undefined;
    }
    lockSeenAt ??= now;
    return lockedAt ?? lockSeenAt;
  };

  // Agents, jobs and dictation, then the microphone and camera; any that fails
  // or takes longer than `checkTimeoutMs` makes the whole answer unknown.
  const readWork = async (): Promise<IdleRestartFacts["work"]> => {
    const answer = await withTimeout(
      Promise.all([readRunningWork(), readCaptureInUse()]),
      timings.checkTimeoutMs,
    ).catch(() => undefined);
    if (!answer) {
      return "unknown";
    }
    const [work, capture] = answer;
    if (work === "busy" || capture === "busy") {
      return "busy";
    }
    return work;
  };

  const readFacts = async (
    update: IdleRestartFacts["update"],
  ): Promise<IdleRestartFacts> => {
    const recorded =
      update.type === "ready"
        ? readAutomaticRestart(update.version)
        : { attempts: 0, lastAt: undefined };
    // Counted only when there is something to restart for.
    const work = update.type === "ready" ? await readWork() : "unknown";
    const windows = BrowserWindow.getAllWindows().filter(
      (window) => !window.isDestroyed(),
    );
    const now = Date.now();
    return {
      attempts: recorded.attempts,
      lastAutomaticRestartAt: recorded.lastAt,
      now,
      person: {
        awayMs: powerMonitor.getSystemIdleTime() * 1000,
        lockedSince: readLockedSince(now),
      },
      update,
      windows: {
        focused: BrowserWindow.getFocusedWindow() !== null,
        fullScreen: windows.some((window) => window.isFullScreen()),
        shown: windows.some(
          (window) => window.isVisible() && !window.isMinimized(),
        ),
      },
      work,
    };
  };

  const currentUpdate = (): IdleRestartFacts["update"] => {
    const readiness = updater.readiness();
    return readiness.type === "ready" && !installable()
      ? { type: "busy" }
      : readiness;
  };

  // Said once per change, so a wait that lasts hours is one line in the log.
  const say = (verdict: IdleRestartVerdict) => {
    const line =
      verdict.type === "wait"
        ? `waiting: ${verdict.blocker}`
        : `restart (${verdict.reason})`;
    if (line !== lastSaid) {
      lastSaid = line;
      log.info(line);
    }
  };

  const restart = async (
    ready: Extract<IdleRestartFacts["update"], { type: "ready" }>,
  ) => {
    restarting = true;
    const outcome = await updater
      .quitAndInstall({
        confirm: async (version) => {
          // The last look, as one more reading: the lock, the windows and
          // everything running are read again. The install has just decided
          // on the update, and its own request is what makes the updater
          // read as busy now.
          const facts = await readFacts(ready);
          const step = stepIdleRestart({ facts, state, timings });
          state = step.state;
          const { verdict } = step;
          if (verdict.type !== "restart" || !approveQuitQuietly()) {
            log.info(
              `Called off the restart: ${verdict.type === "wait" ? verdict.blocker : "the quit is already being decided"}`,
            );
            return false;
          }
          try {
            recordAutomaticInstall({
              inView: verdict.reason === "backstop",
              now: Date.now(),
              to: version,
              view: windowView(),
            });
          } catch (error) {
            log.error(
              "Could not record the restart, so it is called off",
              error,
            );
            withdrawQuitApproval();
            return false;
          }
          log.info(`Restarting to install ${version} (${verdict.reason})`);
          return true;
        },
        type: "automatic",
      })
      .catch((error: unknown) => ({
        message: String(error),
        type: "failed" as const,
      }));
    if (outcome.type !== "installing") {
      log.info(`The restart did not go ahead: ${outcome.type}`);
      restarting = false;
    }
  };

  const tick = async () => {
    if (restarting) {
      // Still on its way out, unless an install that failed after the quit
      // began has let the updater go (`failed` in create-app-updater.ts).
      if (updater.readiness().type === "busy") {
        return;
      }
      restarting = false;
    }
    const update = currentUpdate();
    const focusesBefore = focuses;
    const facts = await readFacts(update);
    if (focuses !== focusesBefore) {
      return;
    }
    const step = stepIdleRestart({ facts, state, timings });
    state = step.state;
    say(step.verdict);
    if (step.verdict.type === "restart" && update.type === "ready") {
      await restart(update);
    }
  };

  const schedule = () => {
    setTimeout(() => {
      tick()
        .catch((error: unknown) => {
          log.error("Could not decide whether to restart", error);
        })
        .finally(schedule);
    }, timings.recheckMs).unref();
  };
  schedule();
}

/** How the app window is left, for the launch the restart ends in. */
function windowView(): RelaunchView {
  const window = getAppWindow();
  if (!window || window.isDestroyed()) {
    return "hidden";
  }
  if (window.isMinimized()) {
    return "minimized";
  }
  return window.isVisible() ? "front" : "hidden";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]).finally(() => {
    clearTimeout(timer);
  });
}

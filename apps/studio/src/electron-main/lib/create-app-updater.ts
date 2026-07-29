import {
  type ProgressInfo,
  type UpdateCheckResult,
  type UpdateInfo,
} from "electron-updater";

import {
  type AppUpdaterStatus,
  createUpdatePhase,
  type InstallOutcome,
  isNewerVersion,
  isSameStatus,
  nextPollDelayMs,
  resolveInstallDecision,
  resolveStatus,
  VERIFY_TIMEOUT_MS,
} from "./update-status";

export interface AppUpdaterHandle {
  checkForUpdates: (options?: { notify?: boolean }) => Promise<void>;
  getStatus: () => AppUpdaterStatus | null;
  pollForUpdates: () => void;
  quitAndInstall: () => Promise<InstallOutcome>;
}

// Every event electron-updater emits that changes what we can act on. Named for
// what it means to us rather than for electron-updater's wire names, so the
// mapping lives in one adapter instead of being spread through the reducer.
export interface UpdaterEvents {
  available: (info: UpdateInfo) => void;
  canceled: (info: UpdateInfo) => void;
  downloaded: (info: UpdateInfo) => void;
  failed: (error: Error) => void;
  notAvailable: (info: UpdateInfo) => void;
  progress: (progress: ProgressInfo) => void;
}

// The slice of electron-updater this module drives. Narrow on purpose: it is the
// seam tests replace, and every member is a real side effect on a process-wide
// singleton.
export interface UpdaterPort {
  checkForUpdates: () => Promise<null | UpdateCheckResult>;
  // Re-applied before every check so a release-channel change takes effect
  // without a restart.
  configureFeed: () => void;
  // Quits and applies the staged build. Never returns on the happy path.
  install: () => void;
  isActive: () => boolean;
  subscribe: (handlers: UpdaterEvents) => void;
}

interface UpdaterLogger {
  error: (message: string, ...args: unknown[]) => void;
  info: (message: string) => void;
  warn: (message: string, ...args: unknown[]) => void;
}

export function createAppUpdater({
  confirmQuit,
  getCurrentVersion,
  installNotice,
  log,
  publish,
  recordCheck,
  updater,
}: {
  // Returns false to abort the install when the user cancels the running-agents
  // warning.
  confirmQuit?: () => Promise<boolean>;
  getCurrentVersion: () => string;
  // Platform copy shown while the install runs, where it takes long enough to
  // need explaining.
  installNotice: string | undefined;
  log: UpdaterLogger;
  publish: (status: AppUpdaterStatus) => void;
  recordCheck: () => void;
  updater: UpdaterPort;
}): AppUpdaterHandle {
  const phase = createUpdatePhase();
  let status: AppUpdaterStatus | null = null;
  let notify = false;
  let installRequest: null | Promise<InstallOutcome> = null;
  let pollTimer: NodeJS.Timeout | undefined;
  let polling = false;
  // Set by the `failed` handler when an install attempt reports an error.
  // electron-updater catches a missing installer or a failed launch, emits
  // `error`, and returns normally instead of throwing, so this is the only
  // signal that `updater.install()` did not take.
  let installFailure: null | string = null;

  // Read-and-clear, so one attempt is never judged by an earlier one's failure.
  const takeInstallFailure = () => {
    const failure = installFailure;
    installFailure = null;
    return failure;
  };

  const setStatus = (next: AppUpdaterStatus) => {
    const resolved = resolveStatus({ next, phase });
    if (status && isSameStatus(status, resolved)) {
      return;
    }
    status = resolved;
    publish(resolved);
  };

  // electron-updater hands back the auto-download promise on the check result and
  // never attaches a rejection handler of its own, so a failed download would
  // surface as an unhandled rejection in the main process. The `failed` event
  // reports it to the user; this takes ownership and separates a download
  // failure from a check failure in the log, which that event cannot do.
  const runCheck = async () => {
    const result = await updater.checkForUpdates();
    if (result?.downloadPromise) {
      void result.downloadPromise.catch((error: unknown) => {
        log.info(`Update download did not complete: ${String(error)}`);
      });
    }
    return result;
  };

  updater.subscribe({
    available: (info) => {
      log.info(`Update available: ${info.version}`);
      if (
        isNewerVersion({
          baseline: phase.staged?.version,
          candidate: info.version,
        })
      ) {
        phase.pendingNewer = info;
        // electron-updater empties its pending cache the moment a different
        // version starts downloading, so whatever was staged is already gone
        // from disk. Claiming otherwise would offer an install that cannot run.
        phase.staged = null;
      } else {
        // The feed re-offers the staged build on every poll; that is not a
        // superseding download.
        phase.pendingNewer = null;
      }
      setStatus({ notifyUser: notify, type: "available", updateInfo: info });
    },
    canceled: (info) => {
      log.info(`Update canceled: ${info.version}`);
      phase.pendingNewer = null;
      setStatus({ notifyUser: notify, type: "canceled", updateInfo: info });
    },
    downloaded: (info) => {
      log.info(`Update downloaded: ${info.version}`);
      phase.pendingNewer = null;
      phase.staged = info;
      // Always notify when an update is ready to install.
      setStatus({ notifyUser: true, type: "downloaded", updateInfo: info });
      // A check resolves when the *check* completes, so the poll that found this
      // build scheduled its successor while nothing was staged yet. Re-arm now
      // or the tighter staged interval would almost never apply.
      schedulePoll();
    },
    failed: (error) => {
      log.error("Updater error:", error);
      phase.pendingNewer = null;
      if (phase.installing) {
        installFailure = error.message;
      }
      // Published before the latch clears, so a failed install surfaces as an
      // error instead of collapsing back into the staged-update status.
      setStatus({
        message: error.message,
        notifyUser: phase.installing || notify,
        type: "error",
      });
      phase.installing = false;
    },
    notAvailable: (info) => {
      log.info("Update not available");
      phase.pendingNewer = null;
      setStatus({
        notifyUser: notify,
        type: "not-available",
        updateInfo: info,
      });
    },
    progress: (progress) => {
      log.info(
        `Download progress: ${progress.percent}%, ${progress.transferred}/${progress.total}`,
      );
      setStatus({ notifyUser: notify, progress, type: "downloading" });
    },
  });

  const checkForUpdates = async ({
    notify: shouldNotify,
  }: { notify?: boolean } = {}) => {
    notify = shouldNotify ?? false;
    updater.configureFeed();

    setStatus({ notifyUser: notify, type: "checking" });

    if (!updater.isActive()) {
      setStatus({ notifyUser: notify, type: "inactive", updateInfo: null });
      return;
    }

    try {
      await runCheck();
    } catch (error) {
      // The `failed` event already published this; the throw is the same failure
      // arriving a second way.
      log.error("Error checking for updates:", error);
    }
  };

  // The pre-install check: what does the feed advertise right now? Returns
  // undefined when it cannot be reached, because an unreachable feed must not
  // strand the user on a build they have already downloaded.
  const verifyLatestVersion = async () => {
    if (!updater.isActive()) {
      return;
    }

    updater.configureFeed();
    notify = true;
    phase.verifying = true;
    setStatus({ notifyUser: true, type: "checking" });

    try {
      const result = await withTimeout(runCheck(), VERIFY_TIMEOUT_MS);
      return result?.updateInfo.version;
    } catch (error) {
      log.warn(
        "Pre-install update check failed, using the staged build:",
        error,
      );
      return;
    } finally {
      phase.verifying = false;
    }
  };

  // Decides against the phase as it stands right now. `latestVersion` is what the
  // feed said moments ago, or undefined to decide from local state alone.
  const decideFromPhase = (latestVersion: string | undefined) =>
    resolveInstallDecision({
      currentVersion: getCurrentVersion(),
      latestVersion,
      pendingVersion: phase.pendingNewer?.version,
      stagedVersion: phase.staged?.version,
    });

  // Publishes and reports everything that is not "go ahead and install", so the
  // decision can be re-run without duplicating how each answer is handled.
  // Returns null only for `install`.
  const reportNonInstall = (
    decision: ReturnType<typeof decideFromPhase>,
  ): InstallOutcome | null => {
    switch (decision.type) {
      case "defer": {
        log.info(
          `Deferring install: ${decision.version} supersedes the staged build`,
        );
        // autoDownload has already started the newer build; its download status
        // is what the user sees, and the install lands on the next request.
        return { type: "deferred", version: decision.version };
      }
      case "install": {
        return null;
      }
      // Both mean "there is nothing here to install", which is a fact about the
      // release feed rather than a failure, so neither shows the user an error.
      case "nothing-staged": {
        log.warn("Install requested with no staged update");
        setStatus({
          notifyUser: true,
          type: "not-available",
          updateInfo: null,
        });
        return { type: "no-update" };
      }
      case "stale-staged": {
        log.warn(
          `Discarding staged ${decision.version}: ${getCurrentVersion()} is already installed`,
        );
        phase.staged = null;
        setStatus({
          notifyUser: true,
          type: "not-available",
          updateInfo: null,
        });
        return { type: "no-update" };
      }
    }
  };

  const reportInstallFailure = (message: string): InstallOutcome => {
    log.error("Error quitting and installing:", message);
    // Published before the latch clears, then cleared so the retry and the
    // before-quit warning are both live again.
    setStatus({ message, notifyUser: true, type: "error" });
    phase.installing = false;
    return { message, type: "failed" };
  };

  const runInstall = async (): Promise<InstallOutcome> => {
    // Verified before the quit prompt, so discovering a superseded build never
    // costs the user a "quit with agents running?" dialog for an install that
    // then does not happen.
    const checked = reportNonInstall(
      decideFromPhase(await verifyLatestVersion()),
    );
    if (checked) {
      return checked;
    }

    // Confirmed after the version check and before the `installing` latch, so a
    // cancel leaves the badge on `downloaded`. before-quit then sees the
    // `installing` status and skips a second prompt.
    if (confirmQuit && !(await confirmQuit())) {
      return { type: "quit-canceled" };
    }

    // The confirmation is a dialog the user can sit on, and the timed-out check
    // above was never cancelled, so a newer release can land while it is open and
    // take the chosen artifact with it. Re-decide from local state, which cannot
    // block, rather than install something that is no longer on disk.
    const confirmed = reportNonInstall(decideFromPhase(undefined));
    if (confirmed) {
      return confirmed;
    }

    installFailure = null;
    phase.installing = true;
    try {
      setStatus({
        notice: installNotice,
        notifyUser: true,
        type: "installing",
      });
      updater.install();
    } catch (error) {
      // Only a genuine throw lands here; the `failed` event is the usual path.
      return reportInstallFailure(
        error instanceof Error ? error.message : String(error),
      );
    }

    const failure = takeInstallFailure();
    // The `failed` handler has already published the error and released the
    // latch, so this only has to stop reporting an install that did not start.
    return failure
      ? { message: failure, type: "failed" }
      : { type: "installing" };
  };

  const runPoll = async () => {
    // Nothing to learn once the app is on its way out, but keep the timer alive
    // so a failed install resumes polling.
    if (!phase.installing) {
      await checkForUpdates();
      recordCheck();
    }
    schedulePoll();
  };

  function schedulePoll() {
    if (!polling) {
      return;
    }
    clearTimeout(pollTimer);
    pollTimer = setTimeout(
      () => {
        void runPoll();
      },
      nextPollDelayMs({ hasStagedUpdate: phase.staged !== null }),
    );
  }

  return {
    checkForUpdates,
    getStatus: () => status,

    pollForUpdates: () => {
      polling = true;
      void runPoll();
    },

    quitAndInstall: () => {
      // Latched before the first await, and shared rather than dropped: the
      // toolbar badge and the Settings button can both fire, and two runs would
      // mean two feed checks, two quit prompts, and two installers.
      if (installRequest) {
        log.info("Install already requested, joining the in-flight request");
        return installRequest;
      }

      const request = runInstall().then(
        (outcome) => {
          // Hold the latch only while the app is on its way out. Every other
          // outcome has to leave the button usable.
          if (outcome.type !== "installing") {
            installRequest = null;
          }
          return outcome;
        },
        (error: unknown) => {
          installRequest = null;
          throw error;
        },
      );
      installRequest = request;
      return request;
    },
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  // Promise.race subscribes to `promise`, so a later rejection stays handled.
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

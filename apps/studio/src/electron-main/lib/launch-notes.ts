// What a launch says about the restart and the version before it: the bell's
// notices and the action log, written once the first window is up. Apart from
// the machine state store they read, which the first window reads too.
import { noteInstalledUpdate } from "@/electron-main/lib/actions";
import {
  IDLE_RESTART,
  type RelaunchView,
} from "@/electron-main/lib/idle-restart-policy";
import { noteInstallFailed, noteUpdate } from "@/electron-main/lib/notices";
import { launchOutcome } from "@/electron-main/lib/update-status";
import { getMachineState } from "@/electron-main/stores/machine/state";
import { app } from "electron";

/**
 * Read once at launch: the marker the restart before this launch left, which
 * is then forgotten, and the attempts, which are forgotten too once the
 * version changed, since an attempt that changed it landed. A restart that
 * came back on the same version for the last attempt it gets is said in the
 * bell, as an install the person asked for would be.
 */
export function takeRelaunchMarker():
  | { at: number; inView?: boolean; view: RelaunchView }
  | undefined {
  const store = getMachineState();
  const record = store.get("automaticRestart");
  if (!record) {
    return undefined;
  }
  const current = app.getVersion();
  const landed = record.attempts?.from !== current;
  if (
    !landed &&
    record.relaunch &&
    record.attempts &&
    record.attempts.count >= IDLE_RESTART.maxAttempts
  ) {
    noteInstallFailed({ from: current, to: record.attempts.to });
  }
  store.set("automaticRestart", {
    attempts: landed ? undefined : record.attempts,
    lastAt: record.lastAt,
    relaunch: undefined,
  });
  return record.relaunch;
}

// Compares the version we last launched with the version running now. A
// strictly-newer running version means the app was updated since the last
// launch, which the bell's notices say, with a toast when the person asked for
// that install. Any change of version goes in the action log too. An install they asked for that left an older version running
// failed after the app quit, where nothing else could say so. Persists the
// current version so the next launch has a baseline.
//
// Only packaged builds can be updated, and only there does the version track
// installs: unpackaged builds read it from the checked-out package.json, so
// every release commit pulled in reads as an update. Dev instances also share
// one userData directory, so worktrees on different commits trade the baseline
// back and forth and each relaunch of the newer one claims a bump.
// FORCE_DEV_AUTO_UPDATE, which already puts the updater itself in its packaged
// behavior, is the way to exercise this in dev.
//
// `restartedInView` is a launch that is the app's own restart in view of the
// person (the backstop), which toasts too, so it does not look like a crash.
export function checkRecentVersionBump({
  restartedInView = false,
}: { restartedInView?: boolean } = {}): void {
  if (!app.isPackaged && process.env.FORCE_DEV_AUTO_UPDATE !== "true") {
    return;
  }

  const store = getMachineState();
  const previous = store.get("lastLaunchedVersion");
  const requested = store.get("installRequested")?.to;
  const current = app.getVersion();

  if (previous !== undefined && previous !== current) {
    noteInstalledUpdate({ from: previous, to: current });
  }
  const outcome = launchOutcome({ current, previous, requested });
  if (outcome.type === "updated") {
    noteUpdate({
      asked: outcome.asked,
      from: outcome.from,
      restarted: restartedInView,
      to: current,
    });
  } else if (outcome.type === "install-failed") {
    noteInstallFailed({ from: current, to: outcome.to });
  }

  store.delete("installRequested");
  store.set("lastLaunchedVersion", current);
}

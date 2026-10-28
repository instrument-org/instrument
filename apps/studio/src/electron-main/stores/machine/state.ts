import { logger } from "@/electron-main/lib/electron-logger";
import { noteInstallFailed, noteUpdate } from "@/electron-main/lib/notices";
import {
  attemptsAt,
  IDLE_RESTART,
  nextAttempts,
  type RelaunchView,
} from "@/electron-main/lib/idle-restart-policy";
import { launchOutcome } from "@/electron-main/lib/update-status";
import { MACHINE_STATE_NAME } from "@/electron-main/lib/settings-migration";
import { publisher } from "@/electron-main/rpc/publisher";
import { SetupRecordSchema } from "@/shared/setup";
import { app } from "electron";
import Store from "electron-store";
import { z } from "zod";

/**
 * What the app remembers about this computer, whichever workspace is open.
 * Per-workspace state is in `workspace/state.ts`.
 */
const MachineStateSchema = z.object({
  /**
   * The restarts the app made on its own to install an update
   * (`lib/idle-restart.ts`): the attempts at one version from the version
   * that made them, when the last one went, and, for the launch it ends in,
   * how the window was left and whether the restart happened in view.
   */
  automaticRestart: z
    .object({
      attempts: z
        .object({ count: z.number(), from: z.string(), to: z.string() })
        .optional(),
      lastAt: z.number().optional(),
      relaunch: z
        .object({
          at: z.number(),
          inView: z.boolean().optional(),
          view: z.enum(["front", "hidden", "minimized"]),
        })
        .optional(),
    })
    .optional()
    .catch(undefined),
  /**
   * This install's device id, which every chat record it writes is filed
   * under, and the SHA-256 of the machine's own id it was made on. Read as
   * plain strings and checked by `chooseDeviceId`, so a value this build
   * cannot use costs a new id rather than the rest of this file.
   */
  deviceId: z.string().optional(),
  hardwareId: z.string().optional(),
  /**
   * The version an install the person asked for was quitting to put in place,
   * for the next launch to say whether it did; see `checkRecentVersionBump`.
   */
  installRequested: z.object({ to: z.string() }).optional().catch(undefined),
  lastLaunchedVersion: z.string().optional(),
  lastUpdateCheck: z.number().optional(),
  /**
   * What the Finder's placing left on disk under names of its own, for the
   * next launch to finish should a quit or crash come first; see
   * `lib/finder-placing/leftovers.ts`.
   */
  placingLeftovers: z
    .array(
      z.object({
        identity: z.object({ dev: z.number(), ino: z.string() }).nullable(),
        kind: z.enum(["staging", "undone"]),
        path: z.string(),
      }),
    )
    .optional()
    .catch(undefined),
  /**
   * Setup's record as earlier builds kept it, once for the whole computer.
   * Carried into the default workspace's own state once and removed
   * (`lib/setup-state.ts`); setup's record is the workspace's now.
   */
  setup: SetupRecordSchema.optional().catch(undefined),
  /**
   * Where setup's window was when the app last quit with setup up, so a
   * restart setup makes (the folder step's) opens it there again rather than
   * centered on the pointer's display. Forgotten once setup is done.
   */
  setupWindowAt: z
    .object({ x: z.number(), y: z.number() })
    .optional()
    .catch(undefined),
});

type MachineState = z.output<typeof MachineStateSchema>;

let STORE: null | Store<MachineState> = null;

export const getMachineState = (): Store<MachineState> => {
  if (STORE === null) {
    const defaults = MachineStateSchema.parse({});
    STORE = new Store<MachineState>({
      defaults,
      deserialize: (value) => {
        const parsed = MachineStateSchema.safeParse(JSON.parse(value));

        if (parsed.success) {
          return parsed.data;
        }

        logger.error("Failed to parse machine state", parsed.error);

        return defaults;
      },
      name: MACHINE_STATE_NAME,
    });

    // Settings shows when updates were last checked, read through
    // `preferences.get`.
    STORE.onDidChange("lastUpdateCheck", () => {
      publisher.publish("preferences.updated", null);
    });
  }

  return STORE;
};

export function setLastUpdateCheck(): void {
  getMachineState().set("lastUpdateCheck", Date.now());
}

/**
 * Records that the app is quitting to install `to` because the person asked,
 * or forgets it when that install did not go ahead.
 */
export function recordInstallRequest(to: null | string): void {
  if (to === null) {
    getMachineState().delete("installRequested");
  } else {
    getMachineState().set("installRequested", { to });
  }
}

/**
 * Records an automatic restart about to install `to`, how the window is left,
 * and whether the restart happens in view, for the launch it ends in.
 */
export function recordAutomaticInstall({
  inView,
  now,
  to,
  view,
}: {
  inView: boolean;
  now: number;
  to: string;
  view: RelaunchView;
}): void {
  const store = getMachineState();
  const record = store.get("automaticRestart");
  store.set("automaticRestart", {
    attempts: nextAttempts({
      attempts: record?.attempts,
      current: app.getVersion(),
      to,
    }),
    lastAt: now,
    relaunch: { at: now, inView, view },
  });
}

/** Forgets the window an automatic restart left, when the restart did not go. */
export function forgetRelaunchMarker(): void {
  const record = getMachineState().get("automaticRestart");
  if (record?.relaunch) {
    getMachineState().set("automaticRestart", {
      ...record,
      relaunch: undefined,
    });
  }
}

/** Attempts already made at `to` from the running version, and when the last restart went. */
export function readAutomaticRestart(to: string): {
  attempts: number;
  lastAt: number | undefined;
} {
  const record = getMachineState().get("automaticRestart");
  return {
    attempts: attemptsAt({
      attempts: record?.attempts,
      current: app.getVersion(),
      to,
    }),
    lastAt: record?.lastAt,
  };
}

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
// that install. An install they asked for that left an older version running
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

import { logger } from "@/electron-main/lib/electron-logger";
import { noteInstallFailed, noteUpdate } from "@/electron-main/lib/notices";
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
export function checkRecentVersionBump(): void {
  if (!app.isPackaged && process.env.FORCE_DEV_AUTO_UPDATE !== "true") {
    return;
  }

  const store = getMachineState();
  const previous = store.get("lastLaunchedVersion");
  const requested = store.get("installRequested")?.to;
  const current = app.getVersion();

  const outcome = launchOutcome({ current, previous, requested });
  if (outcome.type === "updated") {
    noteUpdate({ asked: outcome.asked, from: outcome.from, to: current });
  } else if (outcome.type === "install-failed") {
    noteInstallFailed({ from: current, to: outcome.to });
  }

  store.delete("installRequested");
  store.set("lastLaunchedVersion", current);
}

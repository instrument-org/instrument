import { logger } from "@/electron-main/lib/electron-logger";
import { noteUpdate } from "@/electron-main/lib/notices";
import { MACHINE_STATE_NAME } from "@/electron-main/lib/settings-migration";
import { publisher } from "@/electron-main/rpc/publisher";
import { app } from "electron";
import Store from "electron-store";
import semver from "semver";
import { z } from "zod";

/**
 * What the app remembers about this computer, whichever workspace is open.
 * Per-workspace state is in `workspace/state.ts`.
 */
const MachineStateSchema = z.object({
  lastLaunchedVersion: z.string().optional(),
  lastUpdateCheck: z.number().optional(),
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

// Compares the version we last launched with the version running now. A
// strictly-newer running version means the app was updated since the last
// launch, which the bell's notices say. Persists the current version so the
// next launch has a baseline.
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
  const current = app.getVersion();

  if (
    previous &&
    previous !== current &&
    semver.valid(previous) &&
    semver.valid(current) &&
    semver.gt(current, previous)
  ) {
    noteUpdate({ from: previous, to: current });
  }

  store.set("lastLaunchedVersion", current);
}

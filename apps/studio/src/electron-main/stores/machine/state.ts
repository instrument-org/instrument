import { logger } from "@/electron-main/lib/electron-logger";
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

interface VersionBump {
  from: string;
  to: string;
}

export function setLastUpdateCheck(): void {
  getMachineState().set("lastUpdateCheck", Date.now());
}

// Computed once at startup and consumed exactly once, so the "updated" toast
// fires for the launch that followed the update and not again on a later
// renderer reload.
let recentVersionBump: null | VersionBump = null;
let versionBumpChecked = false;

// Compares the version we last launched with the version running now. A
// strictly-newer running version means the app was updated since the last
// launch. Persists the current version so the next launch has a baseline.
//
// Only packaged builds can be updated, and only there does the version track
// installs: unpackaged builds read it from the checked-out package.json, so
// every release commit pulled in reads as an update. Dev instances also share
// one userData directory, so worktrees on different commits trade the baseline
// back and forth and each relaunch of the newer one claims a bump.
// FORCE_DEV_AUTO_UPDATE, which already puts the updater itself in its packaged
// behavior, is the way to exercise this in dev.
export function checkRecentVersionBump(): void {
  if (versionBumpChecked) {
    return;
  }
  versionBumpChecked = true;

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
    recentVersionBump = { from: previous, to: current };
  }

  store.set("lastLaunchedVersion", current);
}

// Returns the pending version bump and clears it, so only the first caller sees
// it however many times the renderer asks.
export function consumeRecentVersionBump(): null | VersionBump {
  const bump = recentVersionBump;
  recentVersionBump = null;
  return bump;
}

/**
 * Queues a bump for the next reader, for the dev panel's simulation. The real
 * one is computed once at startup from a version the developer cannot move
 * without editing their own config, so this is the only way to see the toast
 * outside an actual update. Consumed the same way, by whoever asks first.
 */
export function setRecentVersionBump(bump: VersionBump): void {
  recentVersionBump = bump;
}

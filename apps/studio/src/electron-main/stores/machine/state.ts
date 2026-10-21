import { logger } from "@/electron-main/lib/electron-logger";
import { noteUpdate } from "@/electron-main/lib/notices";
import { MACHINE_STATE_NAME } from "@/electron-main/lib/settings-migration";
import { publisher } from "@/electron-main/rpc/publisher";
import { SetupRecordSchema } from "@/shared/setup";
import { KEY_FOLDER_NAMES } from "@instrument-org/workspace/electron";
import { app } from "electron";
import Store from "electron-store";
import semver from "semver";
import { z } from "zod";

const KeyFolderNameSchema = z.enum(KEY_FOLDER_NAMES);

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
  lastLaunchedVersion: z.string().optional(),
  lastUpdateCheck: z.number().optional(),
  /**
   * The folders of the six this computer has made at each workspace's top
   * level, by that workspace's path. What tells a folder the person deleted
   * from one that was never there; see `lib/missing-key-folders.ts`.
   */
  madeFolders: z
    .record(z.string(), z.array(KeyFolderNameSchema))
    .optional()
    .catch(undefined),
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
   * The steps of setup answered on this computer, and when it finished
   * (`lib/setup-state.ts`). Machine-wide, so a second workspace does not
   * run setup again.
   */
  setup: SetupRecordSchema.catch({ answered: {} }),
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

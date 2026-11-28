import { storeJson } from "@/electron-main/stores/store-json";
import { logger } from "@/electron-main/lib/electron-logger";
import {
  attemptsAt,
  nextAttempts,
  type RelaunchView,
} from "@/electron-main/lib/idle-restart-policy";
import { publisher } from "@/electron-main/rpc/publisher";
import { SetupRecordSchema } from "@/shared/setup";
import { app } from "electron";
import Store from "@/electron-main/stores/store";
import { z } from "zod";

import { MACHINE_STATE_NAME } from "./names";

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
   * The folders macOS guards that the person let a Files search into
   * (`lib/folder-asks.ts`), which searches from above them then go into.
   */
  searchedFolders: z.array(z.string()).optional().catch(undefined),
  /**
   * Setup's record as earlier builds kept it, once for the whole computer.
   * Carried into the default workspace's own state once and removed
   * (`lib/setup-state.ts`); setup's record is the workspace's now.
   */
  setup: SetupRecordSchema.optional().catch(undefined),
});

type MachineState = z.output<typeof MachineStateSchema>;

let STORE: null | Store<MachineState> = null;

export const getMachineState = (): Store<MachineState> => {
  if (STORE === null) {
    const defaults = MachineStateSchema.parse({});
    STORE = new Store<MachineState>({
      defaults,
      deserialize: (value) => {
        const parsed = MachineStateSchema.safeParse(storeJson(value));

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

/** The marker the restart before this launch left, left where it is. */
export function peekRelaunchMarker() {
  return getMachineState().get("automaticRestart")?.relaunch;
}

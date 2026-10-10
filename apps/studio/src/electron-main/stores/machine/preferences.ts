import { logger } from "@/electron-main/lib/electron-logger";
import { MACHINE_PREFERENCES_NAME } from "@/electron-main/lib/settings-migration";
import { publisher } from "@/electron-main/rpc/publisher";
import {
  NO_SIDEBAR_CHANGES,
  SidebarPlacesSchema,
} from "@/shared/sidebar-places";
import Store from "electron-store";
import { z } from "zod";

/**
 * What a person chose for this computer, whichever workspace is open: which
 * builds it updates to, and what the Files sidebar pins, whose paths are this
 * computer's. Per-workspace choices are in `workspace/preferences.ts`.
 */
export const MachinePreferencesSchema = z.object({
  // Release channels are not exposed to the user and are used internally for testing
  releaseChannel: z
    .enum(["latest", "beta", "alpha"])
    .optional()
    .catch(undefined),
  sidebarPlaces:
    SidebarPlacesSchema.catch(NO_SIDEBAR_CHANGES).default(NO_SIDEBAR_CHANGES),
});

type MachinePreferences = z.output<typeof MachinePreferencesSchema>;

let STORE: null | Store<MachinePreferences> = null;

export const getMachinePreferences = (): Store<MachinePreferences> => {
  if (STORE === null) {
    const defaults = MachinePreferencesSchema.parse({});
    STORE = new Store<MachinePreferences>({
      defaults,
      deserialize: (value) => {
        const parsed = MachinePreferencesSchema.safeParse(JSON.parse(value));

        if (parsed.success) {
          return parsed.data;
        }

        logger.error("Failed to parse machine preferences", parsed.error);

        return defaults;
      },
      name: MACHINE_PREFERENCES_NAME,
    });

    STORE.onDidAnyChange(() => {
      publisher.publish("preferences.updated", null);
    });
  }

  return STORE;
};

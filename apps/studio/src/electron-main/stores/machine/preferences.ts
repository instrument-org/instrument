import { logger } from "@/electron-main/lib/electron-logger";
import { MACHINE_PREFERENCES_NAME } from "@/electron-main/lib/settings-migration";
import { publisher } from "@/electron-main/rpc/publisher";
import Store from "electron-store";
import { z } from "zod";

/* eslint-disable unicorn/prefer-top-level-await */
/**
 * What a person chose for this computer, whichever workspace is open: whether
 * it reports usage, and which builds it updates to. Per-workspace choices are
 * in `workspace/preferences.ts`.
 */
export const MachinePreferencesSchema = z.object({
  enableUsageMetrics: z.boolean().catch(true),
  // Release channels are not exposed to the user and are used internally for testing
  releaseChannel: z
    .enum(["latest", "beta", "alpha"])
    .optional()
    .catch(undefined),
});
/* eslint-enable unicorn/prefer-top-level-await */

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

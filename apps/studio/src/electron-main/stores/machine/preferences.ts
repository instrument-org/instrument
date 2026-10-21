import { logger } from "@/electron-main/lib/electron-logger";
import { MACHINE_PREFERENCES_NAME } from "@/electron-main/lib/settings-migration";
import { publisher } from "@/electron-main/rpc/publisher";
import { PlatformApiServerSchema } from "@/shared/platform-api-server";
import {
  DictationLanguageSchema,
  DictationMicrophoneSchema,
} from "@/shared/dictation";
import {
  NO_SIDEBAR_CHANGES,
  SidebarPlacesSchema,
} from "@/shared/sidebar-places";
import Store from "electron-store";
import { z } from "zod";

/**
 * What a person chose for this computer, whichever workspace is open: which
 * builds it updates to, whether error reports are sent without asking, what
 * the Files sidebar pins, whose paths are this computer's, which platform API
 * server it talks to, and the microphone, language and sounds dictation uses.
 * Per-workspace choices are in `workspace/preferences.ts`.
 */
export const MachinePreferencesSchema = z.object({
  // Unset means the language is detected from the recording.
  dictationLanguage: DictationLanguageSchema.optional().catch(undefined),
  // Unset means the system's default input.
  dictationMicrophone: DictationMicrophoneSchema.optional().catch(undefined),
  // A short sound when dictation starts and when it stops.
  dictationSounds: z.boolean().catch(true).default(true),
  // Release channels are not exposed to the user and are used internally for testing
  releaseChannel: z
    .enum(["latest", "beta", "alpha"])
    .optional()
    .catch(undefined),
  // Set from a report's own checkbox, and turned off in Settings: crashes and
  // app errors are then sent without asking. Chats never are.
  sendErrorReportsAutomatically: z.boolean().catch(false),
  // Set in Settings › Permissions where no sandbox can hold the programs the
  // agent runs: they run anyway, reaching any file the person can. Off, they
  // don't run. A choice about this computer, so it never travels with a
  // workspace.
  runProgramsWithoutSandbox: z.boolean().catch(false),
  sidebarPlaces: SidebarPlacesSchema.catch(NO_SIDEBAR_CHANGES),
  // Set in Settings in developer mode: the platform API server this computer
  // talks to. Unset is the build's own. Read once at startup
  // (`settlePlatformApiServer`), so a change takes a restart.
  platformApiServer: PlatformApiServerSchema.optional().catch(undefined),
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

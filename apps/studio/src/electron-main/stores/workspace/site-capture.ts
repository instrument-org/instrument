import { storeJson } from "@/electron-main/stores/store-json";
import { logger } from "@/electron-main/lib/electron-logger";
import { workspaceBrowserDir } from "@/electron-main/lib/get-workspace-folder";
import Store from "electron-store";
import { z } from "zod";

const SettingSchema = z.enum(["allow", "block"]).optional().catch(undefined);

/**
 * What a person told the in-app browser about one site's use of the
 * microphone and camera: always (`allow`) or never (`block`) for each, ask
 * when neither is set, and the device they picked for each, by its name,
 * since a device's id differs from one site to another.
 */
const SiteCaptureSchema = z.object({
  audio: SettingSchema,
  audioDevice: z.string().optional().catch(undefined),
  video: SettingSchema,
  videoDevice: z.string().optional().catch(undefined),
});

const SiteCaptureStoreSchema = z.object({
  sites: z.record(z.string(), SiteCaptureSchema).catch({}),
});

export type SiteCapture = z.output<typeof SiteCaptureSchema>;
type SiteCaptureStore = z.output<typeof SiteCaptureStoreSchema>;

let STORE: null | Store<SiteCaptureStore> = null;

/** Each site's answers about the microphone and camera, by its origin. */
export const getSiteCaptureStore = (): Store<SiteCaptureStore> => {
  if (STORE === null) {
    const defaults = SiteCaptureStoreSchema.parse({});
    STORE = new Store<SiteCaptureStore>({
      cwd: workspaceBrowserDir(),
      defaults,
      deserialize: (value) => {
        const parsed = SiteCaptureStoreSchema.safeParse(storeJson(value));
        if (parsed.success) {
          return parsed.data;
        }
        logger.error("Failed to parse site capture settings", parsed.error);
        return defaults;
      },
      name: "site-capture",
    });
  }
  return STORE;
};

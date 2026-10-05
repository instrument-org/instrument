import { defineConfig } from "@julr/vite-plugin-validate-env";
import { z } from "zod";

export default defineConfig({
  // Due to this env being used in Node, only use strings and string enums
  schema: {
    // MAIN_VITE_ prefix is available in the electron-main process
    MAIN_VITE_APP_API_BASE_URL: z.string(),
    MAIN_VITE_APP_REGISTRY_DIR_PATH: z.string().optional(),
    MAIN_VITE_GOOGLE_CLIENT_ID: z.string().optional(),
    MAIN_VITE_GOOGLE_CLIENT_SECRET: z.string().optional(),
  },
  validator: "standard",
});

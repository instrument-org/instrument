import { defineConfig } from "@julr/vite-plugin-validate-env";
import { z } from "zod";

export default defineConfig({
  // Due to this env being used in Node, only use strings and string enums
  schema: {
    // MAIN_VITE_ prefix is available in the electron-main process
    MAIN_VITE_APP_API_BASE_URL: z.string(),
    MAIN_VITE_APP_REGISTRY_DIR_PATH: z.string().optional(),
    // Where problem reports go. Unset, the app has nowhere to send them and says so.
    MAIN_VITE_REPORTS_BASE_URL: z.string().optional(),
  },
  validator: "standard",
});

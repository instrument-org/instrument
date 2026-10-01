import { logger } from "@/electron-main/lib/electron-logger";
import { workspaceSettingsDir } from "@/electron-main/lib/get-workspace-folder";
import Store from "electron-store";
import { z } from "zod";

import { getProviderConfigsStore } from "./provider-configs";

/* eslint-disable unicorn/prefer-top-level-await */
/** What the app remembers about this workspace. Machine-wide state is in `machine/state.ts`. */
const WorkspaceStateSchema = z.object({
  hasCompletedProviderSetup: z.boolean().catch(false),
});
/* eslint-enable unicorn/prefer-top-level-await */

type WorkspaceState = z.output<typeof WorkspaceStateSchema>;

let STORE: null | Store<WorkspaceState> = null;

export const getWorkspaceState = (): Store<WorkspaceState> => {
  if (STORE === null) {
    const defaults = WorkspaceStateSchema.parse({});
    STORE = new Store<WorkspaceState>({
      cwd: workspaceSettingsDir(),
      defaults,
      deserialize: (value) => {
        const parsed = WorkspaceStateSchema.safeParse(JSON.parse(value));

        if (parsed.success) {
          return parsed.data;
        }

        logger.error("Failed to parse workspace state", parsed.error);

        return defaults;
      },
      name: "state",
    });

    if (!STORE.get("hasCompletedProviderSetup")) {
      const hasAnyProvider =
        getProviderConfigsStore().get("providers").length > 0;

      if (hasAnyProvider) {
        STORE.set("hasCompletedProviderSetup", true);
      }
    }
  }

  return STORE;
};

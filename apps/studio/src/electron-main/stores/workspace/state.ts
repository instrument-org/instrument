import { logger } from "@/electron-main/lib/electron-logger";
import { workspaceMachineDir } from "@/electron-main/lib/get-workspace-folder";
import Store from "electron-store";
import { z } from "zod";

import { getProviderConfigsStore } from "./provider-configs";

/**
 * What the app remembers about this workspace on this computer: whether its
 * providers are set up, which holds only with this computer's keys. Kept in
 * the workspace's machine folder; machine-wide state is in `machine/state.ts`.
 */
const WorkspaceStateSchema = z.object({
  hasCompletedProviderSetup: z.boolean().catch(false),
});

type WorkspaceState = z.output<typeof WorkspaceStateSchema>;

let STORE: null | Store<WorkspaceState> = null;

export const getWorkspaceState = (): Store<WorkspaceState> => {
  if (STORE === null) {
    const defaults = WorkspaceStateSchema.parse({});
    STORE = new Store<WorkspaceState>({
      cwd: workspaceMachineDir(),
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

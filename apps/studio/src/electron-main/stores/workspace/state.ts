import { logger } from "@/electron-main/lib/electron-logger";
import { workspaceMachineDir } from "@/electron-main/lib/get-workspace-folder";
import { publisher } from "@/electron-main/rpc/publisher";
import { type ModelRoutes } from "@instrument-org/ai-gateway";
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
  // The connection this computer settled on for each model a chat names
  // through another computer's connection (`routeModel`), so it always goes
  // through the same one here. This computer's alone, which is why it is
  // kept here rather than in the chat.
  modelRoutes: z.record(z.string(), z.string()).catch({}),
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

/** This computer's model routes for the workspace, as `fetchModel` and the models list read them. */
export const workspaceModelRoutes: ModelRoutes = {
  read: () => getWorkspaceState().get("modelRoutes"),
  remember(key, providerConfigId) {
    const routes = getWorkspaceState().get("modelRoutes");
    if (routes[key] === providerConfigId) {
      return;
    }
    getWorkspaceState().set("modelRoutes", {
      ...routes,
      [key]: providerConfigId,
    });
    publisher.publish("model-routes.updated", null);
  },
};

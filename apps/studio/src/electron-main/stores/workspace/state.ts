import { perWorkspace } from "@/electron-main/lib/workspace-scope";
import { logger } from "@/electron-main/lib/electron-logger";
import { workspaceMachineDir } from "@/electron-main/lib/get-workspace-folder";
import { publisher } from "@/electron-main/rpc/publisher";
import { type ModelRoutes } from "@instrument-org/ai-gateway";
import Store from "electron-store";
import { z } from "zod";

/**
 * What the app remembers about this workspace on this computer, which holds
 * only with this computer's keys. Kept in the workspace's machine folder;
 * machine-wide state is in `machine/state.ts`.
 */
const WorkspaceStateSchema = z.object({
  // The connection this computer settled on for each model a chat names
  // through another computer's connection (`routeModel`), so it always goes
  // through the same one here. This computer's alone, which is why it is
  // kept here rather than in the chat.
  modelRoutes: z.record(z.string(), z.string()).catch({}),
});

type WorkspaceState = z.output<typeof WorkspaceStateSchema>;

/** Opened once for each workspace, in its scope (`perWorkspace`). */
const storeInScope = perWorkspace((): Store<WorkspaceState> => {
  const defaults = WorkspaceStateSchema.parse({});
  const store = new Store<WorkspaceState>({
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
  return store;
});

const getWorkspaceState = (): Store<WorkspaceState> => {
  return storeInScope();
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

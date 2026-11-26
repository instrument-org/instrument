import { storeJson } from "@/electron-main/stores/store-json";
import { logger } from "@/electron-main/lib/electron-logger";
import { workspaceMachineDir } from "@/electron-main/lib/get-workspace-folder";
import { publisher } from "@/electron-main/rpc/publisher";
import {
  addPick,
  type PickLog,
  pickLogSchema,
} from "@/shared/remembered-picks";
import { type SetupRecord, SetupRecordSchema } from "@/shared/setup";
import { type ModelRoutes } from "@instrument-org/ai-gateway";
import Store from "@/electron-main/stores/store";
import { z } from "zod";

/**
 * What the app remembers about this workspace on this computer, which holds
 * only with this computer's keys. Kept in the workspace's machine folder;
 * machine-wide state is in `machine/state.ts`.
 */
export const WorkspaceStateSchema = z.object({
  // The connection this computer settled on for each model a chat names
  // through another computer's connection (`routeModel`), so it always goes
  // through the same one here. This computer's alone, which is why it is
  // kept here rather than in the chat.
  modelRoutes: z.record(z.string(), z.string()).catch({}),
  // What the person picked for what they typed in the command menu and a new
  // tab's box (`remembered-picks.ts`), which a search puts first when the
  // same letters are typed again. The habits of this computer's keyboard,
  // so they stay here.
  searchPicks: pickLogSchema.catch([]),
  /**
   * The steps of setup answered for this workspace, and when it finished
   * (`lib/setup-state.ts`). Here rather than in the workspace, so it is there
   * from the start of a first launch, before setup gives the workspace its
   * folder.
   */
  setup: SetupRecordSchema.catch({ answered: {} }),
});

type WorkspaceState = z.output<typeof WorkspaceStateSchema>;

let STORE: null | Store<WorkspaceState> = null;

const getWorkspaceState = (): Store<WorkspaceState> => {
  if (STORE === null) {
    const defaults = WorkspaceStateSchema.parse({});
    STORE = new Store<WorkspaceState>({
      cwd: workspaceMachineDir(),
      defaults,
      deserialize: (value) => {
        const parsed = WorkspaceStateSchema.safeParse(storeJson(value));

        if (parsed.success) {
          return parsed.data;
        }

        logger.error("Failed to parse workspace state", parsed.error);

        return defaults;
      },
      name: "state",
    });
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

/** Setup's record for this workspace. */
export function readSetupRecord(): SetupRecord {
  return getWorkspaceState().get("setup");
}

export function writeSetupRecord(record: SetupRecord): void {
  getWorkspaceState().set("setup", record);
}

/** What the person picked for what they typed in a search, oldest first. */
export function readSearchPicks(): PickLog {
  return getWorkspaceState().get("searchPicks");
}

/** Remembers what the person picked for what they typed, as of now. */
export function noteSearchPick(pick: { picked: string; typed: string }): void {
  getWorkspaceState().set(
    "searchPicks",
    addPick(readSearchPicks(), { ...pick, at: Date.now() }),
  );
}

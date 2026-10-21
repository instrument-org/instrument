import { perWorkspace } from "@/electron-main/lib/workspace-scope";
import { logger } from "@/electron-main/lib/electron-logger";
import { workspaceKeysDir } from "@/electron-main/lib/get-workspace-folder";
import {
  type AppConnection,
  AppConnectionSchema,
  type AppConnectionStore,
} from "@instrument-org/workspace/electron";
import Store from "electron-store";
import { z } from "zod";

/**
 * Where every app stands, keyed by slug: connected on which manifest, or what
 * is missing. Not a secret, so plain JSON, but deliberately beside the app
 * credentials it describes, in the workspace's keys on this computer, which
 * the agent never reaches: a call goes through on this record and never on
 * the manifest's say-so, and a connection means nothing without those keys.
 */
const AppConnectionsStoreSchema = z
  .object({
    connections: z.record(z.string(), AppConnectionSchema).default({}),
  })
  .default({ connections: {} });

type AppConnectionsStoreShape = z.output<typeof AppConnectionsStoreSchema>;

/** Opened once for each workspace, in its scope (`perWorkspace`). */
const storeInScope = perWorkspace((): Store<AppConnectionsStoreShape> => {
  const defaults: AppConnectionsStoreShape = { connections: {} };
  const store = new Store<AppConnectionsStoreShape>({
    cwd: workspaceKeysDir(),
    defaults,
    deserialize: (value) => {
      const parsed = AppConnectionsStoreSchema.safeParse(JSON.parse(value));
      if (parsed.success) {
        return parsed.data;
      }
      logger.error("Failed to parse app connections", parsed.error);
      return defaults;
    },
    name: "app-connections",
  });
  return store;
});

function getStore(): Store<AppConnectionsStoreShape> {
  return storeInScope();
}

export const appConnectionStore: AppConnectionStore = {
  get: (slug) => Promise.resolve(getStore().get("connections")[slug]),
  list: () => Promise.resolve(getStore().get("connections")),
  remove: (slug) => {
    const { [slug]: _removed, ...rest } = getStore().get("connections");
    getStore().set("connections", rest);
    return Promise.resolve();
  },
  set: (slug, connection: AppConnection) => {
    getStore().set("connections", {
      ...getStore().get("connections"),
      [slug]: connection,
    });
    return Promise.resolve();
  },
};

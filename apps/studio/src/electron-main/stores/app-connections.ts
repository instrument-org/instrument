import { logger } from "@/electron-main/lib/electron-logger";
import {
  type AppConnection,
  AppConnectionSchema,
  type AppConnectionStore,
} from "@instrument-org/workspace/electron";
import Store from "electron-store";
import { z } from "zod";

/**
 * Where every app stands, keyed by slug: connected on which manifest, or what
 * is missing. Not a secret, so plain JSON, but deliberately outside the
 * workspace, where the agent's file tools cannot reach it: a call goes
 * through on this record and never on the manifest's say-so.
 */
const AppConnectionsStoreSchema = z
  .object({
    connections: z.record(z.string(), AppConnectionSchema).default({}),
  })
  .default({ connections: {} });

type AppConnectionsStoreShape = z.output<typeof AppConnectionsStoreSchema>;

let STORE: null | Store<AppConnectionsStoreShape> = null;

function getStore(): Store<AppConnectionsStoreShape> {
  if (!STORE) {
    const defaults: AppConnectionsStoreShape = { connections: {} };
    STORE = new Store<AppConnectionsStoreShape>({
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
  }
  return STORE;
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

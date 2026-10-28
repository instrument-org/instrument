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
    // Each app's connection read on its own: one a newer build wrote that
    // won't parse costs that app alone, not every app's connection when the
    // next change writes the file back.
    connections: z
      .record(z.string(), z.unknown())
      .default({})
      .transform((entries) =>
        Object.fromEntries(
          Object.entries(entries).flatMap(([slug, entry]) => {
            const parsed = AppConnectionSchema.safeParse(entry);
            if (parsed.success) {
              return [[slug, parsed.data] as const];
            }
            logger.error(`Dropping app connection ${slug}`, parsed.error);
            return [];
          }),
        ),
      ),
  })
  .default({ connections: {} });

type AppConnectionsStoreShape = z.output<typeof AppConnectionsStoreSchema>;

let STORE: null | Store<AppConnectionsStoreShape> = null;

function getStore(): Store<AppConnectionsStoreShape> {
  if (!STORE) {
    const defaults: AppConnectionsStoreShape = { connections: {} };
    STORE = new Store<AppConnectionsStoreShape>({
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

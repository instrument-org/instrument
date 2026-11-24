import { type WorkspaceAppsConfig } from "../../types";
import { type AppConnection } from "./connection";
import { type StoredAppKey } from "./origin-bound";

/**
 * Apps kept in memory: what a headless context (tests, the sandbox script,
 * the evals) gets instead of the desktop app's encrypted stores. Credentials
 * and connections last for the process; there is no sign-in.
 */
export function createMemoryAppsConfig({
  credentials = {},
}: {
  credentials?: Record<string, StoredAppKey | StoredAppKey[]>;
} = {}): WorkspaceAppsConfig {
  const keys = new Map(
    Object.entries(credentials).map(([slug, stored]) => [
      slug,
      [stored].flat(),
    ]),
  );
  const connections = new Map<string, AppConnection>();
  return {
    connections: {
      get: (slug) => Promise.resolve(connections.get(slug)),
      list: () => Promise.resolve(Object.fromEntries(connections)),
      remove: (slug) => {
        connections.delete(slug);
        return Promise.resolve();
      },
      set: (slug, connection) => {
        connections.set(slug, connection);
        return Promise.resolve();
      },
    },
    disconnect: (slug) => {
      keys.delete(slug);
      connections.delete(slug);
      return Promise.resolve();
    },
    getCredentials: (slug) => Promise.resolve(keys.get(slug) ?? []),
  };
}

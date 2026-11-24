import path from "node:path";

import { type DeviceId } from "../records/device-id";
import { getWorkspaceConfig } from "../workspace-config";
import { workspaceLayout } from "../workspace-layout";
import { type SyncedDomain } from "./domains";
import { openSyncedStore, type SyncedStore } from "./synced-store";

/** A workspace, and the device this process writes it as. */
export interface WorkspacePlace {
  device: DeviceId;
  rootDir: string;
}

/** One store per workspace, device and domain in this process, opened on first use. */
const stores = new Map<string, Promise<SyncedStore>>();

/**
 * The workspace this process runs. A launch step that runs before the
 * workspace is up names its own.
 */
export function runningPlace(): WorkspacePlace {
  const { deviceId, rootDir } = getWorkspaceConfig();
  return { device: deviceId, rootDir };
}

/**
 * The store of a domain, held open from its first use on, since a file has
 * one writer in the process.
 */
export function heldStore(
  domain: SyncedDomain,
  { device, rootDir }: WorkspacePlace = runningPlace(),
): Promise<SyncedStore> {
  const { devicesDir } = workspaceLayout(rootDir);
  const key = `${path.resolve(devicesDir)}\0${device}\0${domain}`;
  let store = stores.get(key);
  if (!store) {
    store = openSyncedStore({
      device,
      devicesDir,
      domain,
      onError: (error) => {
        if (process.env.NODE_ENV !== "test") {
          console.warn(
            `Could not read another device's changes to the ${domain}`,
            error,
          );
        }
      },
    });
    stores.set(key, store);
    // A store that failed to open is opened again by the next caller.
    store.catch(() => {
      if (stores.get(key) === store) {
        stores.delete(key);
      }
    });
  }
  return store;
}

/** Stops every held store's watch and forgets it; for tests that start a workspace over. */
export async function closeHeldStores(): Promise<void> {
  const open = [...stores.values()];
  stores.clear();
  for (const store of await Promise.allSettled(open)) {
    if (store.status === "fulfilled") {
      store.value.close();
    }
  }
}

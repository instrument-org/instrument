import { logger } from "@/electron-main/lib/electron-logger";
import { workspaceKeysDir } from "@/electron-main/lib/get-workspace-folder";
import { keyFileDeserializer } from "@/electron-main/lib/key-file";
import { is } from "@electron-toolkit/utils";
import { type StoredAppCredential } from "@instrument-org/workspace/electron";
import { safeStorage } from "electron";
import Store from "electron-store";
import { z } from "zod";

// One secret per app, keyed by the app's folder slug, with the origin it was
// saved for: the workspace sends it nowhere else. Values only ever leave this
// store through the workspace config's `getCredential` at request time; the
// RPC layer exposes presence, never values. A file whose entries carry no
// origin fails the parse and reads as empty, so those apps ask for a key again.
const AppCredentialsStoreSchema = z
  .object({
    credentials: z
      .record(
        z.string(),
        z.object({ origin: z.string().min(1), value: z.string() }),
      )
      .default({}),
  })
  .default({ credentials: {} });

type AppCredentialsStore = z.output<typeof AppCredentialsStoreSchema>;

let APP_CREDENTIALS_STORE: null | Store<AppCredentialsStore> = null;

const getAppCredentialsStore = (): Store<AppCredentialsStore> => {
  if (!APP_CREDENTIALS_STORE) {
    const defaultStore: AppCredentialsStore = { credentials: {} };

    APP_CREDENTIALS_STORE = new Store<AppCredentialsStore>({
      cwd: workspaceKeysDir(),
      defaults: defaultStore,
      deserialize: keyFileDeserializer({
        fallback: () => ({ credentials: {} }),
        log: logger,
        lost: "the keys saved for apps",
        name: "the app credential store",
        parse: (json) => AppCredentialsStoreSchema.parse(json),
      }),
      fileExtension: is.dev ? "json" : "json.enc",
      name: "app-credentials",
      serialize: (value) => {
        if (is.dev) {
          return JSON.stringify(value);
        }

        if (!safeStorage.isEncryptionAvailable()) {
          logger.error("Encryption is not available");
          throw new Error("Encryption is not available");
        }

        const json = JSON.stringify(value);
        return safeStorage.encryptString(json).toString("base64");
      },
    });
  }

  return APP_CREDENTIALS_STORE;
};

export function getAppCredential(slug: string): null | StoredAppCredential {
  return getAppCredentialsStore().get("credentials")[slug] ?? null;
}

export function hasAppCredential(slug: string): boolean {
  return slug in getAppCredentialsStore().get("credentials");
}

export function removeAppCredential(slug: string): void {
  const store = getAppCredentialsStore();
  const { [slug]: _removed, ...rest } = store.get("credentials");
  store.set("credentials", rest);
}

export function setAppCredential(
  slug: string,
  credential: StoredAppCredential,
): void {
  const store = getAppCredentialsStore();
  store.set("credentials", { ...store.get("credentials"), [slug]: credential });
}

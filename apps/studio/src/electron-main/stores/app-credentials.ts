import { logger } from "@/electron-main/lib/electron-logger";
import { is } from "@electron-toolkit/utils";
import { safeStorage } from "electron";
import Store from "electron-store";
import { z } from "zod";

// One secret per app, keyed by the app's folder slug. Values only ever leave
// this store through the workspace config's `getCredential` at request time;
// the RPC layer exposes presence, never values.
const AppCredentialsStoreSchema = z
  .object({
    credentials: z.record(z.string(), z.string()).default({}),
  })
  .default({ credentials: {} });

type AppCredentialsStore = z.output<typeof AppCredentialsStoreSchema>;

let APP_CREDENTIALS_STORE: null | Store<AppCredentialsStore> = null;

export const getAppCredentialsStore = (): Store<AppCredentialsStore> => {
  if (!APP_CREDENTIALS_STORE) {
    const defaultStore: AppCredentialsStore = { credentials: {} };

    APP_CREDENTIALS_STORE = new Store<AppCredentialsStore>({
      defaults: defaultStore,
      deserialize: (value) => {
        if (is.dev) {
          const parsed = AppCredentialsStoreSchema.safeParse(JSON.parse(value));
          if (parsed.success) {
            return parsed.data;
          }
          logger.error("Failed to parse app credentials", parsed.error);
          return defaultStore;
        }

        if (!safeStorage.isEncryptionAvailable()) {
          logger.error("Encryption is not available");
          return defaultStore;
        }

        let jsonData: unknown;
        try {
          const decryptedValue = safeStorage.decryptString(
            Buffer.from(value, "base64"),
          );
          jsonData = JSON.parse(decryptedValue);
        } catch (error) {
          logger.error("Failed to decrypt or parse JSON", error);
          return defaultStore;
        }

        const parsed = AppCredentialsStoreSchema.safeParse(jsonData);
        if (parsed.success) {
          return parsed.data;
        }
        logger.error("Failed to parse app credentials", parsed.error);
        return defaultStore;
      },
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

export function getAppCredential(slug: string): null | string {
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

export function setAppCredential(slug: string, value: string): void {
  const store = getAppCredentialsStore();
  store.set("credentials", { ...store.get("credentials"), [slug]: value });
}

import { logger } from "@/electron-main/lib/electron-logger";
import { publisher } from "@/electron-main/rpc/publisher";
import { is } from "@electron-toolkit/utils";
import { safeStorage } from "electron";
import Store from "electron-store";
import { z } from "zod";

// One secret per connector, keyed by the connector's folder slug. Values only
// ever leave this store through WorkspaceConfig.connectors.getCredential at
// request time; the RPC layer exposes presence, never values.
const ConnectorCredentialsStoreSchema = z
  .object({
    credentials: z.record(z.string(), z.string()).default({}),
  })
  .default({ credentials: {} });

type ConnectorCredentialsStore = z.output<
  typeof ConnectorCredentialsStoreSchema
>;

let CONNECTOR_CREDENTIALS_STORE: null | Store<ConnectorCredentialsStore> = null;

export const getConnectorCredentialsStore =
  (): Store<ConnectorCredentialsStore> => {
    if (!CONNECTOR_CREDENTIALS_STORE) {
      const defaultStore: ConnectorCredentialsStore = { credentials: {} };

      CONNECTOR_CREDENTIALS_STORE = new Store<ConnectorCredentialsStore>({
        defaults: defaultStore,
        deserialize: (value) => {
          if (is.dev) {
            const parsed = ConnectorCredentialsStoreSchema.safeParse(
              JSON.parse(value),
            );
            if (parsed.success) {
              return parsed.data;
            }
            logger.error("Failed to parse connector credentials", parsed.error);
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

          const parsed = ConnectorCredentialsStoreSchema.safeParse(jsonData);
          if (parsed.success) {
            return parsed.data;
          }
          logger.error("Failed to parse connector credentials", parsed.error);
          return defaultStore;
        },
        fileExtension: is.dev ? "json" : "json.enc",
        name: "connector-credentials",
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

      CONNECTOR_CREDENTIALS_STORE.onDidAnyChange(() => {
        publisher.publish("connectors.updated", null);
      });
    }

    return CONNECTOR_CREDENTIALS_STORE;
  };

export function getConnectorCredential(slug: string): null | string {
  return getConnectorCredentialsStore().get("credentials")[slug] ?? null;
}

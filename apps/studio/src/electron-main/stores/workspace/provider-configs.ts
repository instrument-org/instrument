import { perWorkspace } from "@/electron-main/lib/workspace-scope";
import { logger } from "@/electron-main/lib/electron-logger";
import { workspaceKeysDir } from "@/electron-main/lib/get-workspace-folder";
import {
  decodeKeyFile,
  encodeKeyFile,
  KEY_FILE_EXTENSION,
  KEY_STORE_NAMES,
} from "@/electron-main/lib/key-file";
import { publisher } from "@/electron-main/rpc/publisher";
import { AIGatewayProviderConfig } from "@instrument-org/ai-gateway";
import {
  type AIProviderConfigId,
  AIProviderConfigIdSchema,
} from "@instrument-org/shared";
import Store from "electron-store";
import { z } from "zod";

const ProviderConfigsStoreSchema = z
  .object({
    // Named "providers" originally, but now "providerConfigs" to avoid
    // confusion with the AIProviderType type. Kept as "providers" here to
    // support existing data.
    //
    // Each entry parses on its own, so one the app no longer knows (a provider
    // type since removed) is dropped rather than failing the list and taking
    // every other saved key with it.
    providers: z
      .array(z.unknown())
      .default([])
      .transform((entries) =>
        entries.flatMap((entry) => {
          const parsed = AIGatewayProviderConfig.Schema.safeParse(entry);
          if (parsed.success) {
            return [parsed.data];
          }
          logger.warn("Dropping a provider config that no longer parses", {
            issues: parsed.error.issues,
          });
          return [];
        }),
      ),
    // The connections turned off without being removed, by id: saved keys and
    // signed-in accounts alike, so the accounts' own stores need no field.
    disabled: z.array(AIProviderConfigIdSchema).default([]).catch([]),
  })
  .default({ disabled: [], providers: [] });

type ProviderConfigsStore = z.output<typeof ProviderConfigsStoreSchema>;

/** Opened once for each workspace, in its scope (`perWorkspace`). */
const storeInScope = perWorkspace((): Store<ProviderConfigsStore> => {
  const defaultStore: ProviderConfigsStore = {
    disabled: [],
    providers: [],
  };

  const store = new Store<ProviderConfigsStore>({
    cwd: workspaceKeysDir(),
    defaults: defaultStore,
    deserialize: (value) => {
      let jsonData: unknown;
      try {
        jsonData = JSON.parse(decodeKeyFile(value));
      } catch (error) {
        logger.error("Failed to decrypt or parse JSON", error);
        return defaultStore;
      }

      const parsed = ProviderConfigsStoreSchema.safeParse(jsonData);

      if (parsed.success) {
        return parsed.data;
      }

      logger.error("Failed to parse provider configs", parsed.error);
      return defaultStore;
    },
    fileExtension: KEY_FILE_EXTENSION,
    name: KEY_STORE_NAMES.providerConfigs,
    serialize: (value) => {
      const encoded = encodeKeyFile(JSON.stringify(value));
      if (encoded === undefined) {
        logger.error("Encryption is not available");
        return "";
      }
      return encoded;
    },
  });

  store.onDidAnyChange(() => {
    publisher.publish("provider-config.updated", null);
  });
  return store;
});

export const getProviderConfigsStore = (): Store<ProviderConfigsStore> => {
  return storeInScope();
};

/** The connections turned off, which `getAIProviderConfigs` leaves out. */
export function getDisabledProviderConfigIds(): ReadonlySet<AIProviderConfigId> {
  return new Set(getProviderConfigsStore().get("disabled"));
}

export function setProviderConfigEnabled(
  id: AIProviderConfigId,
  enabled: boolean,
): void {
  const store = getProviderConfigsStore();
  const rest = store.get("disabled").filter((entry) => entry !== id);
  store.set("disabled", enabled ? rest : [...rest, id]);
}

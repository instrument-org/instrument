import { logger } from "@/electron-main/lib/electron-logger";
import { workspaceKeysDir } from "@/electron-main/lib/get-workspace-folder";
import {
  keyFileDeserializer,
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

let PROVIDER_CONFIGS_STORE: null | Store<ProviderConfigsStore> = null;

export const getProviderConfigsStore = (): Store<ProviderConfigsStore> => {
  if (!PROVIDER_CONFIGS_STORE) {
    const defaultStore: ProviderConfigsStore = {
      disabled: [],
      providers: [],
    };

    PROVIDER_CONFIGS_STORE = new Store<ProviderConfigsStore>({
      cwd: workspaceKeysDir(),
      defaults: defaultStore,
      deserialize: keyFileDeserializer({
        fallback: () => ({ disabled: [], providers: [] }),
        log: logger,
        lost: "its provider keys",
        name: "the provider key store",
        parse: (json) => ProviderConfigsStoreSchema.parse(json),
      }),
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

    PROVIDER_CONFIGS_STORE.onDidAnyChange(() => {
      publisher.publish("provider-config.updated", null);
    });
  }

  return PROVIDER_CONFIGS_STORE;
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

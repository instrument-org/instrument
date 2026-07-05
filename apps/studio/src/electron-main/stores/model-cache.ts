import { logger } from "@/electron-main/lib/electron-logger";
import { AIGatewayModel, type ModelCache } from "@instrument-org/ai-gateway";
import Store from "electron-store";
import { z } from "zod";

// Model lists are provider-scoped, and providers are app-global (their configs
// live in the app-global provider-configs store, not the workspace folder), so
// this cache is app-global too. It survives restarts to serve stale model lists
// when a provider is slow or unreachable on startup.
/* eslint-disable unicorn/prefer-top-level-await */
const ModelCacheStoreSchema = z.object({
  // Keyed by provider `cacheIdentifier`. A single corrupt or schema-drifted
  // provider entry falls back to [] (which read() treats as cold) instead of
  // discarding every provider's cache; a malformed top-level store fails
  // safeParse and is logged + reset by the deserialize handler below.
  models: z
    .record(z.string(), AIGatewayModel.Schema.array().catch([]))
    .default({}),
});
/* eslint-enable unicorn/prefer-top-level-await */

type ModelCacheStore = z.output<typeof ModelCacheStoreSchema>;

let MODEL_CACHE_STORE: null | Store<ModelCacheStore> = null;

function getModelCacheStore(): Store<ModelCacheStore> {
  if (MODEL_CACHE_STORE === null) {
    const defaults = ModelCacheStoreSchema.parse({});
    MODEL_CACHE_STORE = new Store<ModelCacheStore>({
      defaults,
      deserialize: (value) => {
        const parsed = ModelCacheStoreSchema.safeParse(JSON.parse(value));

        if (parsed.success) {
          return parsed.data;
        }

        logger.error("Failed to parse model cache", parsed.error);

        return defaults;
      },
      name: "model-cache",
    });
  }

  return MODEL_CACHE_STORE;
}

export const diskModelCache: ModelCache = {
  read(cacheIdentifier) {
    const models = getModelCacheStore().get("models")[cacheIdentifier];
    // Treat a missing or empty entry as a cold cache so a degraded write never
    // masks a real "no models" state as a successful fallback.
    return models && models.length > 0 ? models : undefined;
  },
  write(cacheIdentifier, models) {
    try {
      const store = getModelCacheStore();
      store.set("models", {
        ...store.get("models"),
        [cacheIdentifier]: models,
      });
    } catch (error) {
      logger.error("Failed to write model cache", error);
    }
  },
};

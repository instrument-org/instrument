import { logger } from "@/electron-main/lib/electron-logger";
import { AIGatewayModel, type ModelCache } from "@instrument-org/ai-gateway";
import Store from "@/electron-main/stores/store";
import { z } from "zod";

// Model lists are provider-scoped, and providers are app-global (their configs
// live in the app-global provider-configs store, not the workspace folder), so
// this cache is app-global too. It survives restarts to serve stale model lists
// when a provider is slow or unreachable on startup.
const ModelCacheStoreSchema = z.object({
  // Keyed by provider `cacheIdentifier`. A single corrupt or schema-drifted
  // provider entry falls back to [] (which read() treats as cold) instead of
  // discarding every provider's cache; a malformed top-level store fails
  // safeParse and is logged + reset by the deserialize handler below.
  models: z
    .record(z.string(), AIGatewayModel.Schema.array().catch([]))
    .default({}),
  // When each provider's list was last written, by the same key, so the lists
  // of providers no longer listed anywhere are dropped.
  written: z.record(z.string(), z.number()).default({}).catch({}),
});

type ModelCacheStore = z.output<typeof ModelCacheStoreSchema>;

let MODEL_CACHE_STORE: null | Store<ModelCacheStore> = null;

function getModelCacheStore(): Store<ModelCacheStore> {
  if (MODEL_CACHE_STORE === null) {
    const defaults = ModelCacheStoreSchema.parse({});
    MODEL_CACHE_STORE = new Store<ModelCacheStore>({
      defaults,
      deserialize: (value) => {
        // electron-store defaults clearInvalidConfig to false, so a corrupt
        // (non-JSON) file would otherwise throw out of every get()/set(). This
        // is a disposable cache, so treat any unreadable data as cold.
        try {
          const parsed = ModelCacheStoreSchema.safeParse(JSON.parse(value));

          if (parsed.success) {
            return parsed.data;
          }

          logger.error("Failed to parse model cache", parsed.error);
        } catch (error) {
          logger.error("Failed to read model cache", error);
        }

        return defaults;
      },
      name: "model-cache",
    });
  }

  return MODEL_CACHE_STORE;
}

// How long a provider's list is kept after it was last written: one written
// before writes were dated, or by a connection since removed or a workspace
// not opened in that time, is dropped at the next write.
const KEEP_UNWRITTEN_MS = 30 * 24 * 60 * 60 * 1000;

// How old a provider's `written` stamp may grow before an unchanged list is
// written again, so a connection in use all along is never pruned as unwritten.
const RESTAMP_MS = 24 * 60 * 60 * 1000;

// Last value persisted per provider in this process, and when, used to skip
// redundant disk writes. Every surface that mounts the model picker refetches
// the list (via a network response that fetchJson caches in-memory for an
// hour), so without this the unchanged list would be re-serialized and
// atomically rewritten to disk each time.
const lastWrittenByIdentifier = new Map<
  string,
  { at: number; serialized: string }
>();

export const diskModelCache: ModelCache = {
  read(cacheIdentifier) {
    const models = getModelCacheStore().get("models")[cacheIdentifier];
    // Treat a missing or empty entry as a cold cache so a degraded write never
    // masks a real "no models" state as a successful fallback.
    return models && models.length > 0 ? models : undefined;
  },
  write(cacheIdentifier, models) {
    try {
      const serialized = JSON.stringify(models);
      const now = Date.now();
      const last = lastWrittenByIdentifier.get(cacheIdentifier);
      if (last?.serialized === serialized && now - last.at < RESTAMP_MS) {
        return;
      }
      const store = getModelCacheStore();
      const written = Object.fromEntries(
        Object.entries(store.get("written")).filter(
          ([, at]) => now - at < KEEP_UNWRITTEN_MS,
        ),
      );
      written[cacheIdentifier] = now;
      const kept = store.get("models");
      store.set({
        models: Object.fromEntries(
          Object.keys(written).flatMap((key) => {
            const list = key === cacheIdentifier ? models : kept[key];
            return list ? [[key, list]] : [];
          }),
        ),
        written,
      });
      lastWrittenByIdentifier.set(cacheIdentifier, { at: now, serialized });
    } catch (error) {
      logger.error("Failed to write model cache", error);
    }
  },
};

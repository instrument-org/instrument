import { LRUCache } from "lru-cache";
import ms from "ms";

// Held as the only thing the registry needs from them, so caches of unrelated
// value types can share it.
const caches = new Set<{ clear: () => void }>();

export function clearCachedResults() {
  for (const cache of caches) {
    cache.clear();
  }
}

/**
 * A cache for one kind of value.
 *
 * Each caller gets its own store rather than a slot in a shared one, so the
 * value type is the type that was written and no read has to assert what it
 * found. Every cache made here is cleared by `clearCachedResults`.
 */
export function createResultCache<T extends object>() {
  const cache = new LRUCache<string, T>({
    max: 1000,
    ttl: ms("1 hour"),
  });
  caches.add(cache);
  return cache;
}

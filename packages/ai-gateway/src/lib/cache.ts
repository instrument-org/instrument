import { LRUCache } from "lru-cache";
import ms from "ms";

const globalCache = new LRUCache<string, object>({
  max: 1000,
  ttl: ms("1 hour"),
});

export function clearCachedResults() {
  globalCache.clear();
}

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
export function getCachedResult<T>(key: string): T | undefined {
  return globalCache.get(key) as T | undefined;
}

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
export function setCachedResult<T extends object>(
  key: string,
  value: T,
  { ttl }: { ttl?: number } = {},
): void {
  globalCache.set(key, value, { ttl });
}

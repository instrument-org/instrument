import { os } from "@orpc/server";
import ms from "ms";

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

class TTLCache<T> {
  private cache = new Map<string, CacheEntry<T>>();

  // Clean up expired entries
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: string, value: T, ttl: number): void {
    const expiresAt = Date.now() + ttl;
    this.cache.set(key, { expiresAt, value });
  }
}

const cache = new TTLCache<unknown>();

setInterval(() => {
  cache.cleanup();
}, ms("10 minutes"));

export const cacheMiddleware = os
  .$context<{ cacheTTL?: number }>()
  .middleware(async ({ context, next, path }, input, output) => {
    const cacheKey = JSON.stringify([path, input]);
    const ttl = context.cacheTTL ?? ms("5 minutes");

    // One lookup, not has()/get(): both re-check the expiry independently, so a
    // clock crossing `expiresAt` between them served `undefined` as a hit.
    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      return output(cached);
    }

    const result = await next({});

    cache.set(cacheKey, result.output, ttl);

    return result;
  });

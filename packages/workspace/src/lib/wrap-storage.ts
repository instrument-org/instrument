import { ResultAsync, safeTry, ok } from "neverthrow";
import { type Storage } from "unstorage";

import { TypedError } from "./errors";

/** One row a batch writes: its value as stored, or its removal. */
type StoreWrite =
  | { key: string; remove: true }
  | { key: string; value: string };

export interface WrappedStorage {
  /** Writes every row or none: a reader sees all of them land at once. */
  batch: (
    writes: readonly StoreWrite[],
    options?: { signal?: AbortSignal },
  ) => ResultAsync<void, TypedError.Storage>;
  dispose: Storage["dispose"];
  getItemRaw: <T = unknown>(
    key: string,
    options?: { signal?: AbortSignal },
  ) => ResultAsync<null | T, TypedError.Storage>;
  getKeys: (
    base?: string,
    options?: { signal?: AbortSignal },
  ) => ResultAsync<string[], TypedError.Storage>;
  removeItem: (
    key: string,
    options?: { signal?: AbortSignal },
  ) => ResultAsync<void, TypedError.Storage>;
  setItemRaw: (
    key: string,
    value: unknown,
    options?: { signal?: AbortSignal },
  ) => ResultAsync<void, TypedError.Storage>;
}

// Expose return values as neverthrow ResultAsync instead of Promise
export function wrapStorage(storage: Storage): WrappedStorage {
  const wrapped: WrappedStorage = {
    // One row at a time, so not atomic: for a storage with no transactions
    // of its own, such as the in-memory one tests use.
    batch: (writes, options) =>
      safeTry(async function* () {
        for (const write of writes) {
          yield* "remove" in write
            ? wrapped.removeItem(write.key, options)
            : wrapped.setItemRaw(write.key, write.value, options);
        }
        return ok(undefined);
      }),
    dispose: storage.dispose.bind(storage),
    getItemRaw: (key, options) =>
      ResultAsync.fromPromise(
        storage.getItemRaw(key, options),
        (error: unknown) =>
          new TypedError.Storage(
            error instanceof Error
              ? error.message
              : "Failed to get storage item",
            { cause: error },
          ),
      ),
    getKeys: (base, options) =>
      ResultAsync.fromPromise(
        storage.getKeys(base, options),
        (error: unknown) =>
          new TypedError.Storage(
            error instanceof Error
              ? error.message
              : "Failed to get storage keys",
            { cause: error },
          ),
      ),
    removeItem: (key, options) =>
      ResultAsync.fromPromise(
        storage.removeItem(key, options),
        (error: unknown) =>
          new TypedError.Storage(
            error instanceof Error
              ? error.message
              : "Failed to remove storage item",
            { cause: error },
          ),
      ),
    setItemRaw: (key, value, options) =>
      ResultAsync.fromPromise(
        storage.setItemRaw(key, value, options),
        (error: unknown) =>
          new TypedError.Storage(
            error instanceof Error
              ? error.message
              : "Failed to set storage item",
            { cause: error },
          ),
      ),
  };
  return wrapped;
}

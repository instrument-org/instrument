import { createStore } from "jotai";
import { atomWithRefresh } from "jotai/utils";
import { describe, expect, it, vi } from "vitest";

import { atomWithoutSuspense } from "./atom-without-suspense";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("atomWithoutSuspense", () => {
  it("keeps the previous value while a refresh is in flight", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    let current = first.promise;
    const source = atomWithRefresh(() => current);
    const value = atomWithoutSuspense(source, "fallback");
    const store = createStore();
    const unsubscribe = store.sub(value, vi.fn());

    expect(store.get(value)).toBe("fallback");

    first.resolve("first");
    await vi.waitFor(() => {
      expect(store.get(value)).toBe("first");
    });

    current = second.promise;
    store.set(source);
    expect(store.get(value)).toBe("first");

    second.resolve("second");
    await vi.waitFor(() => {
      expect(store.get(value)).toBe("second");
    });

    unsubscribe();
  });
});

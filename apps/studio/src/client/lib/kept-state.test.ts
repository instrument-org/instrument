import { createStore } from "jotai";
import { afterEach, expect, it } from "vitest";

import { clearKeptState, importLocalStorage, keptAtom } from "./kept-state";

afterEach(clearKeptState);

/** A localStorage holding these entries, as an earlier build left it. */
function storageOf(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    keys: () => [...map.keys()],
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

it("brings each studio. key over under its own name and removes it", () => {
  const storage = storageOf({
    "debug-transcript-speed": "4",
    "studio.drafts.v2": JSON.stringify([{ id: "d" }]),
    "studio.zoom.v1": "1.5",
  });

  importLocalStorage(storage);

  const store = createStore();
  expect(store.get(keptAtom("zoom.v1", 1))).toBe(1.5);
  expect(store.get(keptAtom<{ id: string }[]>("drafts.v2", []))).toEqual([
    { id: "d" },
  ]);
  expect(storage.keys()).toEqual(["debug-transcript-speed"]);
});

it("keeps a value already kept over the one in localStorage", () => {
  const store = createStore();
  store.set(keptAtom("zoom.v1", 1), 2);

  importLocalStorage(storageOf({ "studio.zoom.v1": "1.5" }));

  expect(createStore().get(keptAtom("zoom.v1", 1))).toBe(2);
});

it("drops a localStorage value that is not JSON", () => {
  const storage = storageOf({ "studio.zoom.v1": "{" });

  importLocalStorage(storage);

  expect(createStore().get(keptAtom("zoom.v1", 1))).toBe(1);
  expect(storage.keys()).toEqual([]);
});

it.each([
  { initial: 1, kept: "wide" },
  { initial: [] as string[], kept: { 0: "a" } },
  { initial: {}, kept: [] },
  { initial: true, kept: null },
])("reads $kept as the default $initial", ({ initial, kept }) => {
  importLocalStorage(storageOf({ "studio.zoom.v1": JSON.stringify(kept) }));

  expect(createStore().get(keptAtom("zoom.v1", initial))).toEqual(initial);
});

it("hands what was kept to `read`", () => {
  importLocalStorage(storageOf({ "studio.zoom.v1": "9" }));

  const zoom = keptAtom("zoom.v1", 1, (value, initial) =>
    typeof value === "number" ? Math.min(value, 2) : initial,
  );

  expect(createStore().get(zoom)).toBe(2);
});

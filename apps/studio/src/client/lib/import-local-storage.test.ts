import { createStore } from "jotai";
import { afterEach, expect, it } from "vitest";

import { importLocalStorage } from "./import-local-storage";
import { clearKeptState, keptAtom, writeKept } from "./kept-state";

afterEach(clearKeptState);

/** A localStorage holding these entries, as a beta left it. */
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

it("brings each studio. key into its file under its own name and removes it", () => {
  const storage = storageOf({
    "debug-transcript-speed": "4",
    "studio.drafts.v2": JSON.stringify([{ id: "d" }]),
    "studio.zoom.v1": "1.5",
  });

  importLocalStorage(storage);

  const store = createStore();
  expect(store.get(keptAtom("view", "zoom.v1", 1))).toBe(1.5);
  expect(
    store.get(keptAtom<{ id: string }[]>("drafts", "drafts.v2", [])),
  ).toEqual([{ id: "d" }]);
  expect(storage.keys()).toEqual(["debug-transcript-speed"]);
});

it("keeps a value already kept over the one in localStorage", () => {
  writeKept("view", "zoom.v1", 2);

  importLocalStorage(storageOf({ "studio.zoom.v1": "1.5" }));

  expect(createStore().get(keptAtom("view", "zoom.v1", 1))).toBe(2);
});

it("drops a localStorage value that is not JSON", () => {
  const storage = storageOf({ "studio.zoom.v1": "{" });

  importLocalStorage(storage);

  expect(createStore().get(keptAtom("view", "zoom.v1", 1))).toBe(1);
  expect(storage.keys()).toEqual([]);
});

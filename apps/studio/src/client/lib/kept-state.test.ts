import { createStore } from "jotai";
import { afterEach, expect, it } from "vitest";

import { clearKeptState, keptAtom, writeKept } from "./kept-state";

afterEach(clearKeptState);

it("reads what a file keeps under the atom's key, and writes back there", () => {
  writeKept("view", "zoom.v1", 1.5);
  const store = createStore();
  const zoom = keptAtom("view", "zoom.v1", 1);

  expect(store.get(zoom)).toBe(1.5);
  store.set(zoom, 2);
  expect(createStore().get(keptAtom("view", "zoom.v1", 1))).toBe(2);
});

it("keeps the same key in different files apart", () => {
  writeKept("view", "open.v1", false);

  expect(createStore().get(keptAtom("layout", "open.v1", true))).toBe(true);
});

it.each([
  { initial: 1, kept: "wide" },
  { initial: [] as string[], kept: { 0: "a" } },
  { initial: {}, kept: [] },
  { initial: true, kept: null },
])("reads $kept as the default $initial", ({ initial, kept }) => {
  writeKept("view", "value.v1", kept);

  expect(createStore().get(keptAtom("view", "value.v1", initial))).toEqual(
    initial,
  );
});

it("hands what was kept to `read`", () => {
  writeKept("view", "zoom.v1", 9);

  const zoom = keptAtom("view", "zoom.v1", 1, (value, initial) =>
    typeof value === "number" ? Math.min(value, 2) : initial,
  );

  expect(createStore().get(zoom)).toBe(2);
});

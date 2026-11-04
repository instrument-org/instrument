import { createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearKeptState,
  keptAtom,
  keptMembersAtom,
  takeKept,
  writeKept,
} from "./kept-state";

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

describe("a value kept member by member", () => {
  const members = () =>
    keptMembersAtom<Record<string, number>>("layout", "groups.v1", {
      join: (kept) =>
        Object.fromEntries(
          [...kept].flatMap(([key, value]) =>
            typeof value === "number" ? [[key, value]] : [],
          ),
        ),
      split: (value) => new Map(Object.entries(value)),
    });

  it("reads each member, and is empty with none", () => {
    expect(createStore().get(members())).toEqual({});
    writeKept("layout", "groups.v1/a", 1);
    writeKept("layout", "groups.v1/b", 2);
    expect(createStore().get(members())).toEqual({ a: 1, b: 2 });
  });

  it("writes only the members that changed, and removes those gone", () => {
    writeKept("layout", "groups.v1/a", 1);
    writeKept("layout", "groups.v1/b", 2);
    const store = createStore();
    const atom = members();
    store.get(atom);
    const set = vi.fn();
    vi.stubGlobal("window", {
      api: { keptState: { initial: {}, onChange: () => () => {}, set } },
    });
    store.set(atom, { a: 1, c: 3 });
    expect(set.mock.calls).toEqual([
      ["layout", "groups.v1/b", undefined],
      ["layout", "groups.v1/c", 3],
    ]);
    vi.unstubAllGlobals();
    expect(createStore().get(members())).toEqual({ a: 1, c: 3 });
  });

  it("takes what an earlier build kept under another key, once", () => {
    writeKept("layout", "groups.v0", { a: 1 });
    expect(takeKept("layout", "groups.v0")).toEqual({ a: 1 });
    expect(takeKept("layout", "groups.v0")).toBeUndefined();
  });
});

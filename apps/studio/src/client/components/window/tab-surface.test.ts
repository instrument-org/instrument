import { describe, expect, it } from "vitest";

import { dropSurface, putSurface, sameSurface } from "./tab-surface";

// Stand-ins for the elements a slot names: only their identity is read.
const hostA = {} as HTMLElement;
const hostB = {} as HTMLElement;

describe("putSurface", () => {
  it("adds a fact beside the tab's others and leaves other tabs alone", () => {
    const slot = { chrome: undefined, host: hostA, isShown: true };
    const other = { slot: { chrome: undefined, host: hostB, isShown: false } };
    const next = putSurface({ other }, "tab", "slot", slot);
    expect(next).toEqual({ other, tab: { slot } });
    expect(next.other).toBe(other);
  });

  it("returns the same surfaces when the fact is already that value", () => {
    const slot = { chrome: undefined, host: hostA, isShown: true };
    const surfaces = { tab: { slot } };
    expect(putSurface(surfaces, "tab", "slot", slot)).toBe(surfaces);
  });
});

describe("dropSurface", () => {
  it("drops a tab left with nothing to say", () => {
    const slot = { chrome: undefined, host: hostA, isShown: true };
    expect(dropSurface({ tab: { slot } }, "tab", "slot", slot)).toEqual({});
  });

  it("leaves a fact another screen has said since", () => {
    const leaving = { chrome: undefined, host: hostA, isShown: true };
    const arrived = { chrome: undefined, host: hostB, isShown: true };
    const surfaces = { tab: { slot: arrived } };
    expect(dropSurface(surfaces, "tab", "slot", leaving)).toBe(surfaces);
  });

  it("leaves a tab nothing was said for", () => {
    const slot = { chrome: undefined, host: hostA, isShown: true };
    const surfaces = {};
    expect(dropSurface(surfaces, "tab", "slot", slot)).toBe(surfaces);
  });
});

describe("sameSurface", () => {
  it.each([
    ["the same elements", { host: hostA, isShown: true }, true],
    ["another host", { host: hostB, isShown: true }, false],
    ["shown otherwise", { host: hostA, isShown: false }, false],
  ])("tells a slot by its elements: %s", (_name, other, same) => {
    expect(
      sameSurface(
        "slot",
        { chrome: undefined, host: hostA, isShown: true },
        { chrome: undefined, ...other },
      ),
    ).toBe(same);
  });

  it("tells nothing said from something said", () => {
    const slot = { chrome: undefined, host: hostA, isShown: true };
    expect(sameSurface("slot", null, slot)).toBe(false);
    expect(sameSurface("slot", null, null)).toBe(true);
  });
});

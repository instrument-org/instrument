import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createModifierHold,
  groupChordNumbers,
  type HeldHint,
  tabAtChord,
  tabChordNumbers,
} from "./held-chord-hints";

const key = (
  name: string,
  mods: Partial<
    Record<"altKey" | "ctrlKey" | "metaKey" | "repeat" | "shiftKey", boolean>
  > = {},
) => ({
  altKey: name === "Alt",
  ctrlKey: name === "Control",
  key: name,
  metaKey: name === "Meta",
  repeat: false,
  shiftKey: name === "Shift",
  ...mods,
});

describe("createModifierHold", () => {
  let seen: (HeldHint | undefined)[];
  const hold = (isMac = true) =>
    createModifierHold({
      isMac,
      onChange: (hint) => {
        seen.push(hint);
      },
    });
  beforeEach(() => {
    seen = [];
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the tab numbers once Command is held alone past the delay, and hides them on release", () => {
    const keys = hold();
    keys.keydown(key("Meta"));
    vi.advanceTimersByTime(499);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual(["tabs"]);
    keys.keyup();
    expect(seen).toEqual(["tabs", undefined]);
  });

  it("never shows anything for a quick chord", () => {
    const keys = hold();
    keys.keydown(key("Meta"));
    vi.advanceTimersByTime(200);
    keys.keydown(key("t", { metaKey: true }));
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual([]);
  });

  it("takes the numbers down for another key, another modifier, or a blur", () => {
    const keys = hold();
    keys.keydown(key("Meta"));
    vi.advanceTimersByTime(500);
    keys.keydown(key("1", { metaKey: true }));
    keys.keydown(key("Control"));
    vi.advanceTimersByTime(500);
    keys.keydown(key("Shift", { ctrlKey: true }));
    vi.advanceTimersByTime(500);
    keys.keydown(key("Control"));
    vi.advanceTimersByTime(500);
    keys.blur();
    expect(seen).toEqual([
      "tabs",
      undefined,
      "groups",
      undefined,
      "groups",
      undefined,
    ]);
  });

  it("keeps the numbers through the modifier's own repeat", () => {
    const keys = hold();
    keys.keydown(key("Meta"));
    vi.advanceTimersByTime(300);
    keys.keydown(key("Meta", { repeat: true }));
    vi.advanceTimersByTime(200);
    expect(seen).toEqual(["tabs"]);
  });

  it.each([
    { expected: "tabs", isMac: true, name: "Meta" },
    { expected: "groups", isMac: true, name: "Control" },
    { expected: undefined, isMac: true, name: "Alt" },
    { expected: "tabs", isMac: false, name: "Control" },
    { expected: "groups", isMac: false, name: "Alt" },
    { expected: undefined, isMac: false, name: "Meta" },
  ])("$name on mac=$isMac holds $expected", ({ expected, isMac, name }) => {
    const keys = hold(isMac);
    keys.keydown(key(name));
    vi.advanceTimersByTime(500);
    expect(seen).toEqual(expected === undefined ? [] : [expected]);
  });
});

describe("tab chord numbers", () => {
  it.each([
    { count: 1, expected: [1] },
    { count: 3, expected: [1, 2, 3] },
    { count: 9, expected: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
    { count: 11, expected: [1, 2, 3, 4, 5, 6, 7, 8] },
  ])(
    "numbers $count tabs by place, 9 only on a ninth and last",
    ({ count, expected }) => {
      const ids = Array.from({ length: count }, (_, index) => `t${index}`);
      expect([...tabChordNumbers(ids).values()]).toEqual(expected);
    },
  );

  it("keeps 9 for the last tab wherever it is", () => {
    expect(tabAtChord(["a", "b", "c"], 9)).toBe("c");
    expect(tabAtChord(["a", "b", "c"], 3)).toBe("c");
  });

  it("picks the tab each number names", () => {
    const ids = Array.from({ length: 11 }, (_, index) => `t${index}`);
    const numbers = tabChordNumbers(ids);
    for (const [id, number] of numbers) {
      expect(tabAtChord(ids, number)).toBe(id);
    }
    expect(tabAtChord(["a", "b"], 5)).toBeUndefined();
  });

  it("numbers the first nine groups by place", () => {
    const groups = Array.from({ length: 10 }, (_, index) => `g${index}`);
    expect([...groupChordNumbers(groups).values()]).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });
});

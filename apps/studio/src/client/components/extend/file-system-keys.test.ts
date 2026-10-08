import { describe, expect, it } from "vitest";

import {
  listingCommandOf,
  NO_TYPE_AHEAD,
  type TypeAhead,
  typeAhead,
  TYPE_AHEAD_RESET_MS,
} from "./file-system-keys";

/** A press written the way a menu writes a shortcut: `⌘⇧⌥⌃` then the key. */
function press(chord: string) {
  const key = chord.replace(/^[⌘⇧⌥⌃]+/u, "");
  return {
    altKey: chord.includes("⌥"),
    ctrlKey: chord.includes("⌃"),
    key: key === "Space" ? " " : key,
    metaKey: chord.includes("⌘"),
    shiftKey: chord.includes("⇧") && key.length > 1,
  };
}

describe("listingCommandOf", () => {
  it.each([
    ["ArrowDown", { direction: "down", extend: false, type: "move" }],
    ["⇧ArrowUp", { direction: "up", extend: true, type: "move" }],
    ["⌥ArrowLeft", { direction: "left", extend: false, type: "move" }],
    ["⌘ArrowDown", { type: "open" }],
    ["⌃ArrowDown", { type: "open" }],
    ["⌘o", { type: "open" }],
    ["⌘a", { type: "select-all" }],
    ["Enter", { type: "return" }],
    ["Space", { type: "space" }],
    ["q", { char: "q", type: "type-ahead" }],
    ["Q", { char: "q", type: "type-ahead" }],
    ["7", { char: "7", type: "type-ahead" }],
    ["é", { char: "é", type: "type-ahead" }],
    // Left to whoever else wants them.
    ["⌘ArrowUp", null],
    ["⌘ArrowLeft", null],
    ["⌘Enter", null],
    ["⌥Enter", null],
    ["⌘c", null],
    ["⌥q", null],
    ["-", null],
    ["Tab", null],
    ["Escape", null],
  ])("reads %s on the Mac", (chord, command) => {
    expect(listingCommandOf(press(chord), true)).toEqual(command);
  });

  it("takes Ctrl+A, not ⌘A, for every row off the Mac", () => {
    expect(listingCommandOf(press("⌃a"), false)).toEqual({
      type: "select-all",
    });
    expect(listingCommandOf(press("⌘a"), false)).toBeNull();
    expect(listingCommandOf(press("⌃a"), true)).toBeNull();
  });

  it.each([
    // The Finder's Move to Trash, and only that.
    [true, "⌘Backspace", { type: "trash" }],
    [true, "Backspace", null],
    [true, "Delete", null],
    [true, "⌘Delete", null],
    [true, "⌥⌘Backspace", null],
    [true, "⌃Backspace", null],
    // Explorer's and the Linux file managers' Delete; Shift+Delete skips the
    // bin, which nothing here does.
    [false, "Delete", { type: "trash" }],
    [false, "⇧Delete", null],
    [false, "⌃Delete", null],
    [false, "Backspace", null],
    [false, "⌃Backspace", null],
  ])("reads the trash key (Mac: %s) from %s", (isMac, chord, command) => {
    expect(listingCommandOf(press(chord), isMac)).toEqual(command);
  });
});

describe("typeAhead", () => {
  const ENTRIES = ["apple", "apricot", "banana", "blueberry", "cherry"].map(
    (name) => ({ name }),
  );

  /** Letters typed at the given times, from the row at `from`; the names landed on. */
  function typeAll(keys: Array<[string, number]>, from = -1) {
    let state: TypeAhead = NO_TYPE_AHEAD;
    let currentIndex = from;
    return keys.map(([char, now]) => {
      const result = typeAhead({
        char,
        currentIndex,
        entries: ENTRIES,
        now,
        state,
      });
      state = result.state;
      if (result.match) currentIndex = ENTRIES.indexOf(result.match);
      return result.match?.name ?? null;
    });
  }

  it.each([
    {
      keys: [["b", 0]],
      landed: ["banana"],
      name: "jumps to the first name starting with a letter",
    },
    {
      keys: [
        ["a", 0],
        ["p", 100],
        ["r", 200],
      ],
      landed: ["apple", "apple", "apricot"],
      name: "refines in place as more is typed",
    },
    {
      keys: [
        ["b", 0],
        ["b", 2000],
        ["b", 4000],
      ],
      landed: ["banana", "blueberry", "banana"],
      name: "cycles through one letter pressed again after a pause",
    },
    {
      keys: [
        ["a", 0],
        ["c", TYPE_AHEAD_RESET_MS + 1],
      ],
      landed: ["apple", "cherry"],
      name: "starts over once the pause has run out",
    },
    {
      keys: [
        ["a", 0],
        ["x", 100],
      ],
      landed: ["apple", null],
      name: "finds nothing for a string no name starts with",
    },
  ])("$name", ({ keys, landed }) => {
    expect(typeAll(keys as Array<[string, number]>)).toEqual(landed);
  });

  it("steps past the row the keyboard is on for a single letter", () => {
    expect(typeAll([["a", 0]], 0)).toEqual(["apricot"]);
  });
});

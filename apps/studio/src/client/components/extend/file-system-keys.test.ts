import { describe, expect, it } from "vitest";

import { type Os } from "@/shared/os-conventions";

import {
  listingCommandOf,
  listingKeys,
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
    code: /^[a-z]$/iu.test(key) ? `Key${key.toUpperCase()}` : "",
    ctrlKey: chord.includes("⌃"),
    key: key === "Space" ? " " : key,
    metaKey: chord.includes("⌘"),
    shiftKey: chord.includes("⇧"),
  };
}

describe("listingCommandOf", () => {
  it.each([
    ["ArrowDown", { direction: "down", extend: false, type: "move" }],
    ["⇧ArrowUp", { direction: "up", extend: true, type: "move" }],
    ["⌥ArrowLeft", { direction: "left", extend: false, type: "move" }],
    ["⌘ArrowDown", { type: "open" }],
    ["⌘o", { type: "open" }],
    ["⌘a", { type: "select-all" }],
    // The Finder's Enclosing Folder and New Folder.
    ["⌘ArrowUp", { type: "parent" }],
    ["⇧⌘N", { type: "new-folder" }],
    ["⌥ArrowUp", { direction: "up", extend: false, type: "move" }],
    ["Enter", { type: "return" }],
    ["Space", { type: "space" }],
    ["q", { char: "q", type: "type-ahead" }],
    ["Q", { char: "q", type: "type-ahead" }],
    ["7", { char: "7", type: "type-ahead" }],
    ["é", { char: "é", type: "type-ahead" }],
    // Left to whoever else wants them.
    ["⇧⌘ArrowUp", null],
    ["⌃ArrowDown", null],
    ["⌘N", null],
    ["⌘ArrowLeft", null],
    ["⌘Enter", null],
    ["⌥Enter", null],
    ["⌘v", null],
    ["⌥q", null],
    ["-", null],
    ["Tab", null],
    ["Escape", null],
    // The Finder renames on Return, and F2 means nothing to it.
    ["F2", null],
  ])("reads %s on the Mac", (chord, command) => {
    expect(listingCommandOf(press(chord), "mac")).toEqual(command);
  });

  // File Explorer, GNOME Files and Dolphin open on Enter, rename on F2, go up
  // on Alt+↑ and make a folder on Ctrl+Shift+N.
  it.each(
    (["windows", "linux"] as const).flatMap((os) =>
      (
        [
          ["Enter", { type: "open" }],
          ["F2", { type: "rename" }],
          ["⌃F2", null],
          ["⇧F2", null],
          ["⌃o", { type: "open" }],
          ["⌥ArrowUp", { type: "parent" }],
          ["⌃⇧N", { type: "new-folder" }],
          ["⌘ArrowUp", null],
          ["⌃ArrowUp", null],
        ] as const
      ).map(([chord, command]) => [os, chord, command] as const),
    ),
  )("reads %s from %s", (os, chord, command) => {
    expect(listingCommandOf(press(chord), os)).toEqual(command);
  });

  it("takes Ctrl+A, not ⌘A, for every row off the Mac", () => {
    expect(listingCommandOf(press("⌃a"), "windows")).toEqual({
      type: "select-all",
    });
    expect(listingCommandOf(press("⌘a"), "windows")).toBeNull();
    expect(listingCommandOf(press("⌃a"), "mac")).toBeNull();
  });

  it.each<[Os, string, { type: "trash" } | null]>([
    // The Finder's Move to Trash, and only that.
    ["mac", "⌘Backspace", { type: "trash" }],
    ["mac", "Backspace", null],
    ["mac", "Delete", null],
    ["mac", "⌘Delete", null],
    ["mac", "⌥⌘Backspace", null],
    ["mac", "⌃Backspace", null],
    // Explorer's and the Linux file managers' Delete; Shift+Delete skips the
    // bin, which nothing here does.
    ["windows", "Delete", { type: "trash" }],
    ["windows", "⇧Delete", null],
    ["windows", "⌃Delete", null],
    ["windows", "Backspace", null],
    ["windows", "⌃Backspace", null],
    ["linux", "Delete", { type: "trash" }],
    ["linux", "⇧Delete", null],
  ])("reads the trash key on %s from %s", (os, chord, command) => {
    expect(listingCommandOf(press(chord), os)).toEqual(command);
  });

  it.each<[Os, string, { type: "copy" | "copy-path" | "duplicate" } | null]>([
    // Every file manager's Copy.
    ["mac", "⌘c", { type: "copy" }],
    ["windows", "⌃c", { type: "copy" }],
    ["linux", "⌃c", { type: "copy" }],
    ["mac", "⇧⌘c", null],
    // The Finder's Duplicate and Copy as Pathname.
    ["mac", "⌘d", { type: "duplicate" }],
    ["mac", "⌥⌘c", { type: "copy-path" }],
    ["mac", "⇧⌘d", null],
    ["mac", "⌃c", null],
    // File Explorer's Copy as path. Its Ctrl+D deletes, so it stays unclaimed.
    ["windows", "⌃⇧C", { type: "copy-path" }],
    ["windows", "⌃d", null],
    ["windows", "⌃⌥c", null],
    ["linux", "⌃⇧C", null],
    ["linux", "⌃d", null],
  ])("reads the copy keys on %s from %s", (os, chord, command) => {
    expect(listingCommandOf(press(chord), os)).toEqual(command);
  });

  it("goes by the key's place for ⌥⌘C, since Option types ç on it", () => {
    expect(listingCommandOf({ ...press("⌥⌘ç"), code: "KeyC" }, "mac")).toEqual({
      type: "copy-path",
    });
  });
});

describe("listingKeys", () => {
  it("names the keys each system's listing answers to", () => {
    expect({
      linux: listingKeys("linux"),
      mac: listingKeys("mac"),
      windows: listingKeys("windows"),
    }).toMatchInlineSnapshot(`
      {
        "linux": {
          "copy": "Ctrl+C",
          "copyPath": null,
          "duplicate": null,
          "newFolder": "Ctrl+Shift+N",
          "open": "Enter",
          "paste": "Ctrl+V",
          "preview": "Space",
          "rename": "F2",
          "trash": "Del",
        },
        "mac": {
          "copy": "⌘C",
          "copyPath": "⌥⌘C",
          "duplicate": "⌘D",
          "newFolder": "⇧⌘N",
          "open": "⌘O",
          "paste": "⌘V",
          "preview": "Space",
          "rename": "↩",
          "trash": "⌘⌫",
        },
        "windows": {
          "copy": "Ctrl+C",
          "copyPath": "Ctrl+Shift+C",
          "duplicate": null,
          "newFolder": "Ctrl+Shift+N",
          "open": "Enter",
          "paste": "Ctrl+V",
          "preview": "Space",
          "rename": "F2",
          "trash": "Del",
        },
      }
    `);
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

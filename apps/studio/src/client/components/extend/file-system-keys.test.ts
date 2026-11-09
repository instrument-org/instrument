import { describe, expect, it } from "vitest";

import { type Os } from "@/shared/os-conventions";

import {
  endsTypeAhead,
  isBackspaceBackPress,
  isQuickLookPress,
  isTypingAhead,
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
    ["Q", { char: "Q", type: "type-ahead" }],
    ["7", { char: "7", type: "type-ahead" }],
    ["é", { char: "é", type: "type-ahead" }],
    ["-", { char: "-", type: "type-ahead" }],
    ["⇧_", { char: "_", type: "type-ahead" }],
    [".", { char: ".", type: "type-ahead" }],
    ["⇧(", { char: "(", type: "type-ahead" }],
    ["🙂", { char: "🙂", type: "type-ahead" }],
    // Left to whoever else wants them.
    ["⇧⌘ArrowUp", null],
    ["⌃ArrowDown", null],
    ["⌘N", null],
    ["⌘ArrowLeft", null],
    ["⌘Enter", null],
    ["⌥Enter", null],
    ["⌘v", null],
    ["⌥q", null],
    // The window's own, for its shortcut guide.
    ["⇧?", null],
    // Words for a key, which type nothing.
    ["Tab", null],
    ["Escape", null],
    ["Dead", null],
    ["Process", null],
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
    // File Explorer's Copy as path.
    ["windows", "⌃⇧C", { type: "copy-path" }],
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
          "cut": "Ctrl+X",
          "duplicate": null,
          "info": "Alt+Enter",
          "moveHere": null,
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
          "cut": null,
          "duplicate": "⌘D",
          "info": "⌘I",
          "moveHere": "⌥⌘V",
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
          "cut": "Ctrl+X",
          "duplicate": null,
          "info": "Alt+Enter",
          "moveHere": null,
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

describe("the file manager's own keys", () => {
  const keyed = (chord: string, code: string) => ({ ...press(chord), code });

  it.each([
    ["mac", press("⌥⌘v"), { type: "move-here" }],
    ["windows", press("⌃x"), { type: "cut" }],
    ["linux", press("⌃x"), { type: "cut" }],
    ["windows", press("⌃d"), { type: "trash" }],
    ["mac", keyed("⇧⌘>", "Period"), { type: "toggle-hidden" }],
    ["linux", press("⌃h"), { type: "toggle-hidden" }],
    // Nothing of the kind on that system, so the letter is left alone.
    ["mac", press("⌘x"), null],
    ["windows", press("⌃⌥v"), null],
    ["linux", press("⌃d"), null],
    ["windows", press("⌃h"), null],
  ] as const)("reads a press on %s: %#", (os, pressed, command) => {
    expect(listingCommandOf(pressed, os)).toEqual(command);
  });

  it.each([
    ["mac", "Space", true],
    ["windows", "Space", true],
    ["mac", "⌘y", true],
    ["windows", "⌃y", false],
    ["linux", "⌃y", false],
    ["mac", "⌘Space", false],
  ] as const)("on %s, %s previews: %s", (os, chord, previews) => {
    expect(isQuickLookPress(press(chord), os)).toBe(previews);
  });

  it.each([
    ["windows", "Backspace", true],
    ["windows", "⌃Backspace", false],
    ["mac", "Backspace", false],
    ["linux", "Backspace", false],
  ] as const)("on %s, %s goes back: %s", (os, chord, goes) => {
    expect(isBackspaceBackPress(press(chord), os)).toBe(goes);
  });
});

describe("typeAhead", () => {
  // A decomposed name is how some disks keep it: "É" as an E and an accent.
  const NAMES = [
    "Applications",
    "Movies",
    "Music",
    "Moment.txt",
    "Herdr-1.dmg",
    "Herdr.dmg",
    "my file.txt",
    "my-file.txt",
    "my_file.txt",
    "mystery.txt",
    "resume-old.txt",
    "Résumé.pdf",
    "Zebra.txt",
    "10 tickets.txt",
    "9 tickets.txt",
    "Eagle.txt",
    "E\u0301clair.txt",
    "_underscore.txt",
    "-dash.txt",
    "(paren).txt",
    "straße.txt",
    "Stream.txt",
  ];
  const ENTRIES = NAMES.map((name) => ({ name }));

  /** Characters typed at the given times; the names landed on. */
  function typeAll(keys: Array<[string, number]>) {
    let state: TypeAhead = NO_TYPE_AHEAD;
    return keys.map(([char, now]) => {
      const result = typeAhead({ char, entries: ENTRIES, now, state });
      state = result.state;
      return result.match?.name ?? null;
    });
  }

  /** Where a string lands, typed quickly from nothing. */
  const landsOn = (typed: string) =>
    typeAll(Array.from(typed, (char, at) => [char, at * 50])).at(-1);

  it.each([
    ["m", "Moment.txt"],
    ["mm", "Moment.txt"],
    ["mo", "Moment.txt"],
    ["mov", "Movies"],
    ["mu", "Music"],
    ["MU", "Music"],
    // Between two names: the later one.
    ["mox", "Music"],
    // No such name: the one after where it would be.
    ["herder", "Herdr-1.dmg"],
    ["herdr-", "Herdr-1.dmg"],
    ["herdr.", "Herdr.dmg"],
    // Later than every name: the last.
    ["zzzz", "Zebra.txt"],
    ["u", "Zebra.txt"],
    ["my f", "my file.txt"],
    ["my-", "my-file.txt"],
    ["my_", "my_file.txt"],
    ["mys", "mystery.txt"],
    ["e", "Eagle.txt"],
    ["ec", "E\u0301clair.txt"],
    ["resu", "resume-old.txt"],
    ["strass", "straße.txt"],
    ["stre", "Stream.txt"],
    ["9", "9 tickets.txt"],
    ["1", "10 tickets.txt"],
    ["-", "-dash.txt"],
    ["_", "_underscore.txt"],
    ["(", "(paren).txt"],
  ])("lands %j on %s", (typed, name) => {
    expect(landsOn(typed)).toBe(name);
  });

  it("stays on a letter pressed again after a pause", () => {
    const pause = TYPE_AHEAD_RESET_MS + 1;
    expect(
      typeAll([
        ["m", 0],
        ["m", pause],
        ["m", pause * 2],
      ]),
    ).toEqual(["Moment.txt", "Moment.txt", "Moment.txt"]);
  });

  it("starts over once the pause has run out", () => {
    expect(
      typeAll([
        ["m", 0],
        ["u", TYPE_AHEAD_RESET_MS + 1],
      ]),
    ).toEqual(["Moment.txt", "Zebra.txt"]);
  });

  it("gives each character the whole pause again", () => {
    const pause = TYPE_AHEAD_RESET_MS - 1;
    expect(
      typeAll([
        ["m", 0],
        ["o", pause],
        ["v", pause * 2],
      ]),
    ).toEqual(["Moment.txt", "Moment.txt", "Movies"]);
  });

  it("reads the names in any order the view shows them", () => {
    const entries = [...ENTRIES].reverse();
    const { match } = typeAhead({
      char: "m",
      entries,
      now: 0,
      state: NO_TYPE_AHEAD,
    });
    expect(match?.name).toBe("Moment.txt");
  });

  it("finds nothing among no names", () => {
    expect(
      typeAhead({ char: "m", entries: [], now: 0, state: NO_TYPE_AHEAD }).match,
    ).toBeNull();
  });

  it("is typing only while the pause lasts", () => {
    const { state } = typeAhead({
      char: "m",
      entries: ENTRIES,
      now: 100,
      state: NO_TYPE_AHEAD,
    });
    expect(isTypingAhead(NO_TYPE_AHEAD, 100)).toBe(false);
    expect(isTypingAhead(state, 100 + TYPE_AHEAD_RESET_MS)).toBe(true);
    expect(isTypingAhead(state, 100 + TYPE_AHEAD_RESET_MS + 1)).toBe(false);
  });

  it.each([
    ["Escape", true],
    ["Tab", true],
    ["Backspace", false],
    ["ArrowDown", false],
    ["m", false],
  ])("%s ends the search: %s", (key, ends) => {
    expect(endsTypeAhead({ key })).toBe(ends);
  });
});

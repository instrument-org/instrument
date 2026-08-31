import { resolveAccelerator, SHORTCUT_ENTRIES } from "@/shared/shortcuts";
import { describe, expect, it } from "vitest";

import { matchesAccelerator, parseAccelerator } from "./match-accelerator";

type Modifier = "alt" | "control" | "meta" | "shift";

/**
 * A key event as `before-input-event` reports it: `key` is what the layout
 * typed, `code` where the key physically sits. The two only agree on QWERTY,
 * which is the whole point of several cases below.
 */
function keyInput(key: string, code: string, ...held: Modifier[]) {
  return {
    alt: held.includes("alt"),
    code,
    control: held.includes("control"),
    key,
    meta: held.includes("meta"),
    shift: held.includes("shift"),
  };
}

describe("matchesAccelerator", () => {
  it.each([
    // The chord the menu never gets to see, and the one next to it.
    {
      accelerator: "CmdOrCtrl+R",
      input: keyInput("r", "KeyR", "meta"),
      match: true,
    },
    {
      accelerator: "CmdOrCtrl+Shift+R",
      input: keyInput("R", "KeyR", "meta", "shift"),
      match: true,
    },
    {
      accelerator: "CmdOrCtrl+R",
      input: keyInput("R", "KeyR", "meta", "shift"),
      match: false,
    },
    {
      accelerator: "CmdOrCtrl+Shift+R",
      input: keyInput("r", "KeyR", "meta"),
      match: false,
    },
    // CmdOrCtrl is Command here, so Control alone is a different chord.
    {
      accelerator: "CmdOrCtrl+R",
      input: keyInput("r", "KeyR", "control"),
      match: false,
    },
    {
      accelerator: "CmdOrCtrl+R",
      input: keyInput("r", "KeyR", "meta", "alt"),
      match: false,
    },
    {
      accelerator: "CmdOrCtrl+R",
      input: keyInput("t", "KeyT", "meta"),
      match: false,
    },
    // Named keys, which carry no character to be decided by.
    {
      accelerator: "Ctrl+Tab",
      input: keyInput("Tab", "Tab", "control"),
      match: true,
    },
    {
      accelerator: "Ctrl+Tab",
      input: keyInput("Tab", "Tab", "control", "shift"),
      match: false,
    },
    {
      accelerator: "Ctrl+Shift+Tab",
      input: keyInput("Tab", "Tab", "control", "shift"),
      match: true,
    },
    {
      accelerator: "Control+Command+F",
      input: keyInput("f", "KeyF", "control", "meta"),
      match: true,
    },
    { accelerator: "F5", input: keyInput("F5", "F5"), match: true },
    // Punctuation and digits.
    {
      accelerator: "CmdOrCtrl+[",
      input: keyInput("[", "BracketLeft", "meta"),
      match: true,
    },
    {
      accelerator: "CmdOrCtrl+,",
      input: keyInput(",", "Comma", "meta"),
      match: true,
    },
    {
      accelerator: "CmdOrCtrl+-",
      input: keyInput("-", "Minus", "meta"),
      match: true,
    },
    {
      accelerator: "CmdOrCtrl+0",
      input: keyInput("0", "Digit0", "meta"),
      match: true,
    },
    // Spelling Shift out asks for the character the key makes with it held.
    {
      accelerator: "CmdOrCtrl+Shift+[",
      input: keyInput("{", "BracketLeft", "meta", "shift"),
      match: true,
    },
    {
      accelerator: "CmdOrCtrl+Shift+[",
      input: keyInput("[", "BracketLeft", "meta"),
      match: false,
    },
    // A token that already names a shifted character doesn't compare Shift:
    // whether it takes Shift to type is the layout's business.
    {
      accelerator: "CmdOrCtrl+Plus",
      input: keyInput("+", "Equal", "meta", "shift"),
      match: true,
    },
    {
      accelerator: "CmdOrCtrl+Plus",
      input: keyInput("=", "Equal", "meta"),
      match: false,
    },
    {
      accelerator: "CmdOrCtrl+=",
      input: keyInput("=", "Equal", "meta"),
      match: true,
    },
    {
      accelerator: "CmdOrCtrl+?",
      input: keyInput("?", "Slash", "meta", "shift"),
      match: true,
    },
    {
      accelerator: "CmdOrCtrl+/",
      input: keyInput("/", "Slash", "meta"),
      match: true,
    },
    // The numpad is why `code` is kept: its `+` types the same character as a
    // shifted `=`, so only the physical key tells them apart.
    {
      accelerator: "CmdOrCtrl+numadd",
      input: keyInput("+", "NumpadAdd", "meta"),
      match: true,
    },
    {
      accelerator: "CmdOrCtrl+numadd",
      input: keyInput("+", "Equal", "meta", "shift"),
      match: false,
    },
    {
      accelerator: "CmdOrCtrl+num5",
      input: keyInput("5", "Numpad5", "meta"),
      match: true,
    },
    // An accelerator this can't read matches nothing rather than something near.
    {
      accelerator: "CmdOrCtrl+1…8",
      input: keyInput("1", "Digit1", "meta"),
      match: false,
    },
    {
      accelerator: "Hyper+R",
      input: keyInput("r", "KeyR", "meta"),
      match: false,
    },
    { accelerator: "", input: keyInput("r", "KeyR", "meta"), match: false },
  ])(
    "$accelerator matches $input.key -> $match",
    ({ accelerator, input, match }) => {
      expect(matchesAccelerator(input, accelerator, { isMac: true })).toBe(
        match,
      );
    },
  );

  // Alt is the one modifier that changes what the key types, so it is the one
  // case decided on where the key sits.
  describe("with Alt held", () => {
    it("takes the key that sits at B, whatever Option made it type", () => {
      // macOS composes Option+B into the integral sign; the position is B.
      expect(
        matchesAccelerator(
          keyInput("∫", "KeyB", "meta", "alt"),
          "CmdOrCtrl+Alt+B",
          { isMac: true },
        ),
      ).toBe(true);
    });

    it("still wants Alt held", () => {
      expect(
        matchesAccelerator(keyInput("b", "KeyB", "meta"), "CmdOrCtrl+Alt+B", {
          isMac: true,
        }),
      ).toBe(false);
      expect(
        matchesAccelerator(
          keyInput("∫", "KeyB", "meta", "alt", "shift"),
          "CmdOrCtrl+Alt+B",
          { isMac: true },
        ),
      ).toBe(false);
    });

    it("reads Ctrl+Alt+B off the same position", () => {
      // Nothing composes it here, so the character arrives intact and the
      // position decides it anyway.
      expect(
        matchesAccelerator(
          keyInput("b", "KeyB", "control", "alt"),
          "CmdOrCtrl+Alt+B",
          { isMac: false },
        ),
      ).toBe(true);
    });

    it("leaves the keys that carry no character alone", () => {
      expect(
        matchesAccelerator(keyInput("Enter", "Enter", "alt"), "Alt+Enter", {
          isMac: true,
        }),
      ).toBe(true);
    });

    // Position can name a letter or a digit and nothing else here, so a chord
    // asking for a character under Alt is refused rather than approximated.
    it("refuses a punctuation chord it would have to guess at", () => {
      expect(parseAccelerator("CmdOrCtrl+Alt+[", { isMac: true })).toBeNull();
    });
  });

  // A chord means the key that types its character, the way the native menu
  // means it. Deciding on the physical position instead puts the app's chords
  // on top of the user's editing keys everywhere but QWERTY.
  describe("on a layout that isn't QWERTY", () => {
    it("does not take Cmd+Z for Close Tab on AZERTY", () => {
      // AZERTY keeps Z where QWERTY keeps W, so undo arrives as `KeyW`.
      const undo = keyInput("z", "KeyW", "meta");
      expect(matchesAccelerator(undo, "CmdOrCtrl+W", { isMac: true })).toBe(
        false,
      );
      expect(matchesAccelerator(undo, "CmdOrCtrl+Z", { isMac: true })).toBe(
        true,
      );
    });

    it("takes the key that types w for Close Tab on AZERTY", () => {
      const close = keyInput("w", "KeyZ", "meta");
      expect(matchesAccelerator(close, "CmdOrCtrl+W", { isMac: true })).toBe(
        true,
      );
    });

    it("keeps Cmd+comma off Close Tab on Dvorak", () => {
      // Dvorak types "," where QWERTY types w, and w where QWERTY types comma.
      expect(
        matchesAccelerator(keyInput(",", "KeyW", "meta"), "CmdOrCtrl+W", {
          isMac: true,
        }),
      ).toBe(false);
      expect(
        matchesAccelerator(keyInput(",", "KeyW", "meta"), "CmdOrCtrl+,", {
          isMac: true,
        }),
      ).toBe(true);
      expect(
        matchesAccelerator(keyInput("w", "Comma", "meta"), "CmdOrCtrl+W", {
          isMac: true,
        }),
      ).toBe(true);
    });
  });

  it("resolves CmdOrCtrl to Control off macOS", () => {
    expect(
      matchesAccelerator(keyInput("r", "KeyR", "control"), "CmdOrCtrl+R", {
        isMac: false,
      }),
    ).toBe(true);
    expect(
      matchesAccelerator(keyInput("r", "KeyR", "meta"), "CmdOrCtrl+R", {
        isMac: false,
      }),
    ).toBe(false);
  });
});

describe("the shortcut table", () => {
  // A chord the binder can't parse silently never fires, which is exactly the
  // failure this matcher exists to end. Fail here instead. Renderer-owned
  // chords are excluded: the page binds those, and `?` is not an accelerator.
  const owned = SHORTCUT_ENTRIES.filter(
    ({ descriptor }) => descriptor.owner !== "renderer",
  );

  it.each(owned)(
    "$id answers to at least one readable chord",
    ({ descriptor }) => {
      for (const isMac of [true, false]) {
        const chords = [
          resolveAccelerator(descriptor.accelerator, { isMac }),
          ...(descriptor.alternates ?? []),
        ];
        expect(
          chords.filter((chord) => parseAccelerator(chord, { isMac })),
        ).not.toHaveLength(0);
      }
    },
  );

  // An alternate is never shown, so a typo in one is invisible until someone
  // presses the key it was meant to be.
  it.each(owned.filter(({ descriptor }) => descriptor.alternates))(
    "$id declares readable alternates",
    ({ descriptor }) => {
      for (const isMac of [true, false]) {
        for (const chord of descriptor.alternates ?? []) {
          expect(parseAccelerator(chord, { isMac })).not.toBeNull();
        }
      }
    },
  );
});

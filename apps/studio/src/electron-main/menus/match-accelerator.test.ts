import { resolveAccelerator, SHORTCUT_ENTRIES } from "@/shared/shortcuts";
import { describe, expect, it } from "vitest";

import { matchesAccelerator, parseAccelerator } from "./match-accelerator";

type Modifier = "alt" | "control" | "meta" | "shift";

function keyInput(code: string, ...held: Modifier[]) {
  return {
    alt: held.includes("alt"),
    code,
    control: held.includes("control"),
    meta: held.includes("meta"),
    shift: held.includes("shift"),
  };
}

describe("matchesAccelerator", () => {
  it.each([
    // The chord the menu never gets to see, and the one next to it.
    {
      accelerator: "CmdOrCtrl+R",
      input: keyInput("KeyR", "meta"),
      match: true,
    },
    {
      accelerator: "CmdOrCtrl+Shift+R",
      input: keyInput("KeyR", "meta", "shift"),
      match: true,
    },
    {
      accelerator: "CmdOrCtrl+R",
      input: keyInput("KeyR", "meta", "shift"),
      match: false,
    },
    {
      accelerator: "CmdOrCtrl+Shift+R",
      input: keyInput("KeyR", "meta"),
      match: false,
    },
    // CmdOrCtrl is Command here, so Control alone is a different chord.
    {
      accelerator: "CmdOrCtrl+R",
      input: keyInput("KeyR", "control"),
      match: false,
    },
    {
      accelerator: "CmdOrCtrl+R",
      input: keyInput("KeyR", "meta", "alt"),
      match: false,
    },
    {
      accelerator: "CmdOrCtrl+R",
      input: keyInput("KeyT", "meta"),
      match: false,
    },
    // Control chords, which the old CmdOrCtrl-only matcher couldn't express.
    { accelerator: "Ctrl+Tab", input: keyInput("Tab", "control"), match: true },
    {
      accelerator: "Ctrl+Tab",
      input: keyInput("Tab", "control", "shift"),
      match: false,
    },
    {
      accelerator: "Ctrl+Shift+Tab",
      input: keyInput("Tab", "control", "shift"),
      match: true,
    },
    {
      accelerator: "Control+Command+F",
      input: keyInput("KeyF", "control", "meta"),
      match: true,
    },
    // Punctuation, digits, and the two faces of the `=` key.
    {
      accelerator: "CmdOrCtrl+[",
      input: keyInput("BracketLeft", "meta"),
      match: true,
    },
    {
      accelerator: "CmdOrCtrl+,",
      input: keyInput("Comma", "meta"),
      match: true,
    },
    {
      accelerator: "CmdOrCtrl+-",
      input: keyInput("Minus", "meta"),
      match: true,
    },
    {
      accelerator: "CmdOrCtrl+0",
      input: keyInput("Digit0", "meta"),
      match: true,
    },
    {
      accelerator: "CmdOrCtrl+Plus",
      input: keyInput("Equal", "meta", "shift"),
      match: true,
    },
    {
      accelerator: "CmdOrCtrl+Plus",
      input: keyInput("Equal", "meta"),
      match: false,
    },
    {
      accelerator: "CmdOrCtrl+=",
      input: keyInput("Equal", "meta"),
      match: true,
    },
    {
      accelerator: "CmdOrCtrl+numadd",
      input: keyInput("NumpadAdd", "meta"),
      match: true,
    },
    {
      accelerator: "CmdOrCtrl+num5",
      input: keyInput("Numpad5", "meta"),
      match: true,
    },
    // Punctuation named by its shifted face carries the Shift it doesn't spell.
    {
      accelerator: "CmdOrCtrl+?",
      input: keyInput("Slash", "meta", "shift"),
      match: true,
    },
    {
      accelerator: "CmdOrCtrl+/",
      input: keyInput("Slash", "meta"),
      match: true,
    },
    {
      accelerator: "CmdOrCtrl+?",
      input: keyInput("Slash", "meta"),
      match: false,
    },
    { accelerator: "F5", input: keyInput("F5"), match: true },
    // An accelerator this can't read matches nothing rather than something near.
    {
      accelerator: "CmdOrCtrl+1…8",
      input: keyInput("Digit1", "meta"),
      match: false,
    },
    { accelerator: "Hyper+R", input: keyInput("KeyR", "meta"), match: false },
    { accelerator: "", input: keyInput("KeyR", "meta"), match: false },
  ])(
    "$accelerator matches $input.code -> $match",
    ({ accelerator, input, match }) => {
      expect(matchesAccelerator(input, accelerator, { isMac: true })).toBe(
        match,
      );
    },
  );

  it("resolves CmdOrCtrl to Control off macOS", () => {
    expect(
      matchesAccelerator(keyInput("KeyR", "control"), "CmdOrCtrl+R", {
        isMac: false,
      }),
    ).toBe(true);
    expect(
      matchesAccelerator(keyInput("KeyR", "meta"), "CmdOrCtrl+R", {
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

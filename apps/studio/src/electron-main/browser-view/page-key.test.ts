import { describe, expect, it } from "vitest";

import { pageKeyOfInput } from "./page-key";

const input = (
  type: string,
  key: string,
  held: {
    alt?: boolean;
    control?: boolean;
    meta?: boolean;
    shift?: boolean;
  } = {},
) => ({
  alt: held.alt ?? false,
  control: held.control ?? false,
  isAutoRepeat: false,
  key,
  meta: held.meta ?? false,
  shift: held.shift ?? false,
  type,
});

describe("pageKeyOfInput", () => {
  it.each([
    ["Meta pressed", input("keyDown", "Meta", { meta: true }), true],
    ["Meta let go", input("keyUp", "Meta"), true],
    ["Control pressed", input("keyDown", "Control", { control: true }), true],
    ["Control let go", input("keyUp", "Control"), true],
    ["Shift pressed alone", input("keyDown", "Shift", { shift: true }), false],
    ["Shift let go alone", input("keyUp", "Shift"), false],
    [
      "Shift pressed with Meta held",
      input("keyDown", "Shift", { meta: true, shift: true }),
      true,
    ],
    ["Option pressed alone", input("keyDown", "Alt", { alt: true }), false],
    [
      "Option pressed with Control held",
      input("keyDown", "Alt", { alt: true, control: true }),
      true,
    ],
    ["a key with Meta held", input("keyDown", "1", { meta: true }), true],
    ["a key with Control held", input("keyDown", "1", { control: true }), true],
    [
      "a character typed with Option",
      input("keyDown", "å", { alt: true }),
      false,
    ],
    ["a capital", input("keyDown", "A", { shift: true }), false],
    ["a typed letter", input("keyDown", "a"), false],
    ["a typed letter let go", input("keyUp", "a"), false],
    ["a key let go with Meta held", input("keyUp", "1", { meta: true }), false],
    ["a character event", input("char", "a"), false],
  ])("on a Mac, %s reaches the window: %s", (_name, event, reaches) => {
    expect(pageKeyOfInput(event, true) !== undefined).toBe(reaches);
  });

  it.each([
    ["Control pressed", input("keyDown", "Control", { control: true }), true],
    ["Alt pressed", input("keyDown", "Alt", { alt: true }), true],
    ["Alt let go", input("keyUp", "Alt"), true],
    ["Shift pressed alone", input("keyDown", "Shift", { shift: true }), false],
    [
      "Shift pressed with Control held",
      input("keyDown", "Shift", { control: true, shift: true }),
      true,
    ],
    ["a key with Control held", input("keyDown", "1", { control: true }), true],
    ["a key with Alt held", input("keyDown", "1", { alt: true }), true],
    [
      "AltGr pressed, after its Control",
      input("keyDown", "AltGraph", { alt: true, control: true }),
      true,
    ],
    [
      "a character typed with AltGr",
      input("keyDown", "é", { alt: true, control: true }),
      false,
    ],
    ["a capital", input("keyDown", "A", { shift: true }), false],
    [
      "a key with the Windows key held",
      input("keyDown", "e", { meta: true }),
      false,
    ],
  ])("elsewhere, %s reaches the window: %s", (_name, event, reaches) => {
    expect(pageKeyOfInput(event, false) !== undefined).toBe(reaches);
  });

  it("carries the key as the window's own listener reads one", () => {
    expect(pageKeyOfInput(input("keyDown", "Meta", { meta: true }), true))
      .toMatchInlineSnapshot(`
      {
        "altKey": false,
        "ctrlKey": false,
        "key": "Meta",
        "metaKey": true,
        "repeat": false,
        "shiftKey": false,
        "type": "keyDown",
      }
    `);
  });
});

import { describe, expect, it } from "vitest";

import { pageKeyOfInput } from "./page-key";

const input = (
  type: string,
  key: string,
  held: { alt?: boolean; control?: boolean; meta?: boolean } = {},
) => ({
  alt: held.alt ?? false,
  control: held.control ?? false,
  isAutoRepeat: false,
  key,
  meta: held.meta ?? false,
  shift: false,
  type,
});

describe("pageKeyOfInput", () => {
  it.each([
    ["Meta pressed", input("keyDown", "Meta", { meta: true }), true],
    ["Meta let go", input("keyUp", "Meta"), true],
    ["Control pressed", input("keyDown", "Control", { control: true }), true],
    ["Shift pressed", input("keyDown", "Shift"), true],
    ["a key with Meta held", input("keyDown", "1", { meta: true }), true],
    ["a key with Alt held", input("keyDown", "1", { alt: true }), true],
    ["a typed letter", input("keyDown", "a"), false],
    ["a typed letter let go", input("keyUp", "a"), false],
    ["a key let go with Meta held", input("keyUp", "1", { meta: true }), false],
    ["a character event", input("char", "a"), false],
  ])("%s reaches the window: %s", (_name, event, reaches) => {
    expect(pageKeyOfInput(event) !== undefined).toBe(reaches);
  });

  it("carries the key as the window's own listener reads one", () => {
    expect(pageKeyOfInput(input("keyDown", "Meta", { meta: true })))
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

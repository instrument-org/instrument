import { describe, expect, it } from "vitest";

import { isListOver } from "./chat-list-width";

describe("isListOver", () => {
  it.each([
    ["not yet measured", 0, 320, false],
    ["wide enough for the narrowest list", 680, 320, false],
    ["too narrow for the narrowest list", 679, 320, true],
    ["wide enough for a list dragged wider", 800, 440, false],
    ["too narrow for a list dragged wider", 760, 440, true],
    ["a list left under its narrowest", 679, 240, true],
  ])("%s", (_case, tabWidth, listWidth, isOver) => {
    expect(isListOver(tabWidth, listWidth)).toBe(isOver);
  });
});

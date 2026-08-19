import { afterEach, describe, expect, it } from "vitest";

import { withMacEditingCommands } from "./mac-editing-commands";

const originalPlatform = process.platform;

function setPlatform(value: string) {
  Object.defineProperty(process, "platform", { configurable: true, value });
}

afterEach(() => {
  setPlatform(originalPlatform);
});

// Modifier bits: Alt=1, Control=2, Meta=4, Shift=8.
const META = 4;
const SHIFT = 8;
const CONTROL = 2;
const ALT = 1;

describe("withMacEditingCommands on macOS", () => {
  it.each([
    ["KeyA", META, "selectAll"],
    ["KeyZ", META, "undo"],
    ["KeyZ", META | SHIFT, "redo"],
    ["Backspace", META, "deleteToBeginningOfLine"],
    ["ArrowLeft", META, "moveToLeftEndOfLine"],
    ["ArrowRight", META, "moveToRightEndOfLine"],
    ["ArrowUp", META | SHIFT, "moveToBeginningOfDocumentAndModifySelection"],
  ])("attaches %s+%d as %s", (code, modifiers, command) => {
    setPlatform("darwin");
    const result = withMacEditingCommands("Input.dispatchKeyEvent", {
      code,
      modifiers,
      type: "rawKeyDown",
    });
    expect(result).toMatchObject({ commands: [command] });
  });

  it.each([
    ["a key-up half", { code: "KeyA", modifiers: META, type: "keyUp" }],
    [
      "commands the caller already set",
      {
        code: "KeyA",
        commands: ["selectAll"],
        modifiers: META,
        type: "rawKeyDown",
      },
    ],
    [
      "a chord with no Command",
      { code: "KeyA", modifiers: SHIFT, type: "rawKeyDown" },
    ],
    [
      "a Command chord that also holds Control",
      { code: "KeyA", modifiers: META | CONTROL, type: "rawKeyDown" },
    ],
    [
      "a Command chord that also holds Alt",
      { code: "KeyA", modifiers: META | ALT, type: "rawKeyDown" },
    ],
    [
      "an unmapped Command chord",
      { code: "KeyB", modifiers: META, type: "rawKeyDown" },
    ],
    ["an event with no code", { modifiers: META, type: "rawKeyDown" }],
  ])("leaves %s alone", (_label, params) => {
    setPlatform("darwin");
    expect(withMacEditingCommands("Input.dispatchKeyEvent", params)).toBe(
      params,
    );
  });

  it("leaves other methods alone", () => {
    setPlatform("darwin");
    const params = { text: "hello" };
    expect(withMacEditingCommands("Input.insertText", params)).toBe(params);
  });

  it("does not mutate the params it was given", () => {
    setPlatform("darwin");
    const params = { code: "KeyA", modifiers: META, type: "rawKeyDown" };
    withMacEditingCommands("Input.dispatchKeyEvent", params);
    expect(params).not.toHaveProperty("commands");
  });
});

describe("withMacEditingCommands off macOS", () => {
  it.each(["win32", "linux"])("leaves chords alone on %s", (platform) => {
    setPlatform(platform);
    const params = { code: "KeyA", modifiers: META, type: "rawKeyDown" };
    expect(withMacEditingCommands("Input.dispatchKeyEvent", params)).toBe(
      params,
    );
  });
});

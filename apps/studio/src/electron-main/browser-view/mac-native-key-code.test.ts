import { afterEach, describe, expect, it } from "vitest";

import { withoutMacNativeKeyCode } from "./mac-native-key-code";

const originalPlatform = process.platform;

function setPlatform(value: string) {
  Object.defineProperty(process, "platform", { configurable: true, value });
}

afterEach(() => {
  setPlatform(originalPlatform);
});

// A Command chord as the client sends it: one code filled into both fields.
const chord = {
  code: "KeyL",
  key: "l",
  modifiers: 4,
  nativeVirtualKeyCode: 76,
  type: "rawKeyDown",
  windowsVirtualKeyCode: 76,
};

describe("withoutMacNativeKeyCode", () => {
  it("drops the native code on macOS and keeps the rest of the chord", () => {
    setPlatform("darwin");
    expect(withoutMacNativeKeyCode("Input.dispatchKeyEvent", chord))
      .toMatchInlineSnapshot(`
      {
        "code": "KeyL",
        "key": "l",
        "modifiers": 4,
        "type": "rawKeyDown",
        "windowsVirtualKeyCode": 76,
      }
    `);
  });

  it("leaves the event alone off macOS, where the two codes agree", () => {
    setPlatform("win32");
    expect(withoutMacNativeKeyCode("Input.dispatchKeyEvent", chord)).toBe(
      chord,
    );
  });

  it("leaves other commands alone", () => {
    setPlatform("darwin");
    const params = { text: "l" };
    expect(withoutMacNativeKeyCode("Input.insertText", params)).toBe(params);
  });

  it("leaves an event that carries no native code alone", () => {
    setPlatform("darwin");
    const params = { key: "l", type: "rawKeyDown" };
    expect(withoutMacNativeKeyCode("Input.dispatchKeyEvent", params)).toBe(
      params,
    );
  });
});

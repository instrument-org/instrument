import { describe, expect, it } from "vitest";

import { readsAsInFront } from "./app-in-front";

const OWN = 4242;

describe("readsAsInFront", () => {
  it.each([
    // macOS with no window open, or any window left for another app.
    ["Electron says unfocused", false, undefined, false],
    ["Electron says unfocused, OS names this app", false, OWN, false],
    // macOS and Linux, where the OS is not asked.
    ["Electron says focused, OS not asked", true, undefined, true],
    ["Electron and the OS agree", true, OWN, true],
    // Windows, the window refused the foreground behind another app.
    ["Electron says focused, OS names another app", true, 9001, false],
    ["Electron says focused, nothing in front", true, 0, false],
  ])("%s", (_, electronFocused, foregroundProcessId, expected) => {
    expect(
      readsAsInFront({
        electronFocused,
        foregroundProcessId,
        ownProcessId: OWN,
      }),
    ).toBe(expected);
  });
});

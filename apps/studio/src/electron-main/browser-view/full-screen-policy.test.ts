import { describe, expect, it } from "vitest";

import { USER_INPUT_WINDOW_MS } from "./external-app-links";
import { mayEnterFullScreen } from "./full-screen-policy";

const granted = {
  record: { role: "webview", userInputAt: 1000 },
  shown: true,
  windowFocused: true,
} as const;

describe("letting a page go full screen", () => {
  it.each([
    ["a click just now", 1500],
    ["a click at the window's edge", 1000 + USER_INPUT_WINDOW_MS],
  ])("grants a shown tab in the focused window after %s", (_case, now) => {
    expect(mayEnterFullScreen(granted, now)).toBe(true);
  });

  it.each([
    [
      "a popup the page opened",
      { record: { role: "popup", userInputAt: 1000 } },
      1500,
    ],
    ["a contents with no record", { record: undefined }, 1500],
    ["a parked tab", { shown: false }, 1500],
    ["a tab in a window without focus", { windowFocused: false }, 1500],
    [
      "a tab nobody used",
      { record: { role: "webview", userInputAt: 0 } },
      1500,
    ],
    ["a tab used too long ago", {}, 1001 + USER_INPUT_WINDOW_MS],
  ] as const)("refuses %s", (_case, change, now) => {
    expect(mayEnterFullScreen({ ...granted, ...change }, now)).toBe(false);
  });
});

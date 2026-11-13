import { describe, expect, it } from "vitest";

import { USER_INPUT_WINDOW_MS } from "./external-app-links";
import { mayCaptureMedia } from "./media-capture-policy";

const clicked = {
  grantedBefore: false,
  record: { role: "webview", userInputAt: 1000 },
  shown: true,
  windowFocused: true,
} as const;

describe("letting a page use the microphone or camera", () => {
  it.each([
    ["a click just now", {}, 1500],
    ["a click at the window's edge", {}, 1000 + USER_INPUT_WINDOW_MS],
    [
      "an origin granted before, with no fresh click",
      { grantedBefore: true },
      1000 + 10 * USER_INPUT_WINDOW_MS,
    ],
  ] as const)("grants a shown tab after %s", (_case, change, now) => {
    expect(mayCaptureMedia({ ...clicked, ...change }, now)).toBe(true);
  });

  it.each([
    [
      "a popup the page opened",
      { record: { role: "popup", userInputAt: 1000 } },
    ],
    ["a contents with no record", { record: undefined }],
    ["a parked tab", { shown: false }],
    ["a parked tab granted before", { grantedBefore: true, shown: false }],
    ["a tab in a window without focus", { windowFocused: false }],
    [
      "a tab nobody used, as when only an agent clicked",
      { record: { role: "webview", userInputAt: 0 } },
    ],
  ] as const)("refuses %s", (_case, change) => {
    expect(mayCaptureMedia({ ...clicked, ...change }, 1500)).toBe(false);
  });

  it("refuses a click too long ago", () => {
    expect(mayCaptureMedia(clicked, 1001 + USER_INPUT_WINDOW_MS)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { USER_INPUT_WINDOW_MS } from "./external-app-links";
import { createFullScreenExitTracker } from "./full-screen-exit";
import { mayEnterFullScreen } from "./full-screen-policy";

const granted = {
  record: { htmlFullScreen: false, role: "webview", userInputAt: 1000 },
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
      { record: { htmlFullScreen: false, role: "popup", userInputAt: 1000 } },
      1500,
    ],
    ["a contents with no record", { record: undefined }, 1500],
    ["a parked tab", { shown: false }, 1500],
    ["a tab in a window without focus", { windowFocused: false }, 1500],
    [
      "a tab nobody used",
      { record: { htmlFullScreen: false, role: "webview", userInputAt: 0 } },
      1500,
    ],
    ["a tab used too long ago", {}, 1001 + USER_INPUT_WINDOW_MS],
  ] as const)("refuses %s", (_case, change, now) => {
    expect(mayEnterFullScreen({ ...granted, ...change }, now)).toBe(false);
  });

  it("grants a page already in full screen asking again mid-transition", () => {
    expect(
      mayEnterFullScreen(
        {
          record: { htmlFullScreen: true, role: "webview", userInputAt: 1000 },
          shown: true,
          windowFocused: false,
        },
        60_000,
      ),
    ).toBe(true);
  });
});

describe("telling pages full screen is over after the window leaves it", () => {
  it.each([
    [
      "Esc or the page's exit: the page leaves, then the window",
      ["pageEntered", "windowLeft"],
      [true],
    ],
    [
      "the window's green button, then a second exit",
      ["pageEntered", "windowLeft", "windowLeft"],
      [true, false],
    ],
    ["a person's own full screen with no page in it", ["windowLeft"], [false]],
  ] as const)("%s", (_case, events, expected) => {
    const tracker = createFullScreenExitTracker();
    const answers: boolean[] = [];
    for (const event of events) {
      if (event === "pageEntered") {
        tracker.pageEntered();
      } else {
        answers.push(tracker.windowLeft());
      }
    }
    expect(answers).toEqual(expected);
  });
});

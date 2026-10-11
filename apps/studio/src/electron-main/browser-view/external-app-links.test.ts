import { describe, expect, it } from "vitest";

import {
  mayOpenInAnotherApp,
  noteUserInput,
  USER_INPUT_WINDOW_MS,
} from "./external-app-links";

describe("handing a page's link to another app", () => {
  it.each([
    ["a click just now", "webview", 1000, 1500, true],
    [
      "a click at the window's edge",
      "webview",
      1000,
      1000 + USER_INPUT_WINDOW_MS,
      true,
    ],
    [
      "a click too long ago",
      "webview",
      1000,
      1001 + USER_INPUT_WINDOW_MS,
      false,
    ],
    ["no input ever", "webview", 0, 1000, false],
    ["a popup the page opened", "popup", 1000, 1500, false],
  ] as const)("%s: %s", (_case, role, userInputAt, now, allowed) => {
    expect(mayOpenInAnotherApp({ role, userInputAt }, now)).toBe(allowed);
  });

  it("refuses a contents with no record", () => {
    expect(mayOpenInAnotherApp(undefined)).toBe(false);
  });
});

describe("recording a person's input", () => {
  it.each([
    ["mouseDown", false, 500],
    ["rawKeyDown", false, 500],
    ["gestureTap", false, 500],
    ["mouseMove", false, 0],
    ["mouseWheel", false, 0],
    ["mouseDown", true, 0],
  ] as const)("%s, agent driving %s, records %s", (type, byAgent, recorded) => {
    const record = { userInputAt: 0 };
    noteUserInput(record, type, byAgent, 500);
    expect(record.userInputAt).toBe(recorded);
  });
});

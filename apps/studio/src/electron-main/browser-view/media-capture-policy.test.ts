import { describe, expect, it } from "vitest";

import { USER_INPUT_WINDOW_MS } from "./external-app-links";
import { mediaDecision } from "./media-capture-policy";

const clicked = {
  grantedBefore: false,
  record: { role: "webview", userInputAt: 1000 },
  settings: ["ask", "ask"],
  shown: true,
  windowFocused: true,
} as const;

describe("deciding a page's request for the microphone or camera", () => {
  it.each([
    ["a click just now", {}, 1500, "ask"],
    ["a click at the window's edge", {}, 1000 + USER_INPUT_WINDOW_MS, "ask"],
    [
      "an origin granted before, with no fresh click",
      { grantedBefore: true },
      1000 + 10 * USER_INPUT_WINDOW_MS,
      "allow",
    ],
    [
      "a site told always, with no fresh click",
      { settings: ["allow", "allow"] },
      1000 + 10 * USER_INPUT_WINDOW_MS,
      "allow",
    ],
    [
      "a site told always for one of the two, after a click",
      { settings: ["allow", "ask"] },
      1500,
      "ask",
    ],
    [
      "a site told never for one of the two, even granted before",
      { grantedBefore: true, settings: ["allow", "block"] },
      1500,
      "blocked",
    ],
    [
      "a site told never, in a parked tab",
      { settings: ["block"], shown: false },
      1500,
      "blocked",
    ],
    ["a click too long ago", {}, 1001 + USER_INPUT_WINDOW_MS, "refuse"],
  ] as const)("on %s", (_case, change, now, decision) => {
    expect(mediaDecision({ ...clicked, ...change }, now)).toBe(decision);
  });

  it.each([
    [
      "a popup the page opened",
      { record: { role: "popup", userInputAt: 1000 } },
    ],
    ["a contents with no record", { record: undefined }],
    ["a parked tab", { shown: false }],
    ["a parked tab granted before", { grantedBefore: true, shown: false }],
    [
      "a parked tab its site told always",
      { settings: ["allow"], shown: false },
    ],
    ["a tab in a window without focus", { windowFocused: false }],
    [
      "a tab nobody used, as when only an agent clicked",
      { record: { role: "webview", userInputAt: 0 } },
    ],
  ] as const)("refuses %s", (_case, change) => {
    expect(mediaDecision({ ...clicked, ...change }, 1500)).toBe("refuse");
  });
});

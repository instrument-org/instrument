import { type WindowTab } from "@/client/atoms/window";
import { describe, expect, it } from "vitest";

import { type StepDirection, stepOf, stepStackOf } from "./tab-steps";

const SCREEN: WindowTab = {
  at: 1,
  href: "/apps",
  id: "s",
  kind: "screen",
  trail: ["/files", "/apps", "/browser"],
};
const PAGE: WindowTab = {
  id: "p",
  kind: "page",
  openedAt: 0,
  url: "https://example.com",
};
const HOME: WindowTab = { href: "/browser", id: "home", kind: "screen" };

const NO_HISTORY = { canGoBack: false, canGoForward: false };
const FULL_HISTORY = { canGoBack: true, canGoForward: true };

describe("which history a step walks", () => {
  it.each<
    [
      string,
      WindowTab | undefined,
      Parameters<typeof stepStackOf>[1],
      StepDirection,
      ReturnType<typeof stepOf>,
    ]
  >([
    [
      "a page's own history first",
      PAGE,
      { guest: FULL_HISTORY },
      "back",
      "guest",
    ],
    [
      "the tab's visits from a page's first entry",
      { ...PAGE, past: [HOME] },
      { guest: NO_HISTORY },
      "back",
      "visits",
    ],
    [
      "nothing from a page with no history and nothing behind it",
      PAGE,
      { guest: NO_HISTORY },
      "back",
      undefined,
    ],
    [
      "nothing of a page's own before its guest has attached",
      { ...PAGE, future: [HOME] },
      { guest: undefined },
      "forward",
      "visits",
    ],
    ["a screen's trail back", SCREEN, { guest: undefined }, "back", "trail"],
    [
      "a screen's trail forward",
      SCREEN,
      { guest: undefined },
      "forward",
      "trail",
    ],
    [
      "the tab's visits at the end of a screen's trail",
      { ...SCREEN, at: 2, future: [PAGE] },
      { guest: undefined },
      "forward",
      "visits",
    ],
    [
      "a site's window tab from its page's first entry, past the new tab it opened with",
      { ...PAGE, past: [HOME] },
      { guest: NO_HISTORY, outer: { canGoBack: true } },
      "back",
      "outer",
    ],
    [
      "a site's page before its window tab",
      PAGE,
      { guest: FULL_HISTORY, outer: { canGoBack: true } },
      "back",
      "guest",
    ],
    [
      "never the window tab forward",
      PAGE,
      { guest: NO_HISTORY, outer: { canGoBack: true } },
      "forward",
      undefined,
    ],
    [
      "the window tab when a site has no page up",
      undefined,
      { guest: undefined, outer: { canGoBack: true } },
      "back",
      "outer",
    ],
  ])("steps %s", (_case, tab, context, direction, expected) => {
    expect(stepOf(stepStackOf(tab, context), direction)).toBe(expected);
  });
});

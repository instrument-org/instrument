import { type WindowTab } from "@/client/atoms/window";
import { describe, expect, it } from "vitest";

import {
  isKeptScreen,
  KEPT_SCREENS,
  withoutClosed,
  withScreenUp,
} from "./kept-screens";

const screen = (href: string): WindowTab => ({
  href,
  id: "tab-1",
  kind: "screen",
});

describe("which screens stay drawn behind the tab up", () => {
  it.each([
    ["/files?file=%2Fhome%2Fnotes.md", true],
    ["/files?path=%2Fhome", true],
    ["/settings", true],
    ["/chats", false],
  ])("%s: %s", (href, kept) => {
    expect(isKeptScreen(screen(href))).toBe(kept);
  });

  it("leaves a page to the browser pool", () => {
    expect(
      isKeptScreen({
        id: "tab-2",
        kind: "page",
        openedAt: 0,
        url: "https://example.com/",
      }),
    ).toBe(false);
  });
});

describe("the screens kept, the one last up first", () => {
  it("puts a screen brought up first, once", () => {
    expect(withScreenUp(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
    expect(withScreenUp(["a", "b"], "d")).toEqual(["d", "a", "b"]);
  });

  it("is the same list for the screen already first, so nothing draws again", () => {
    const kept = ["a", "b"];
    expect(withScreenUp(kept, "a")).toBe(kept);
  });

  it("lets go of the one longest out of sight past the cap", () => {
    const full = Array.from({ length: KEPT_SCREENS + 1 }, (_, at) => `t${at}`);
    const next = withScreenUp(full, "new");
    expect(next).toHaveLength(KEPT_SCREENS + 1);
    expect(next[0]).toBe("new");
    expect(next).not.toContain(`t${KEPT_SCREENS}`);
  });

  it("lets go of a tab that closed, and is the same list when none did", () => {
    const kept = ["a", "b", "c"];
    expect(withoutClosed(kept, new Set(["a", "c"]))).toEqual(["a", "c"]);
    expect(withoutClosed(kept, new Set(["a", "b", "c"]))).toBe(kept);
  });
});

import { type ParsedLocation } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { shouldRestoreScroll } from "./scroll-restoration";

const at = (pathname: string) =>
  shouldRestoreScroll({ location: { pathname } as ParsedLocation });

/**
 * The router copies the previous location's per-element offsets forward onto
 * the next one for any selector that still resolves, then writes them after the
 * render. A page whose scroll belongs to a `MessageScroller` therefore gets
 * handed the offset of whatever scroller the reader just left, which a React
 * key on the content cannot prevent -- the element is new, but it is found by
 * selector and written to afterwards. Opting the page out is what stops it.
 */
describe("shouldRestoreScroll", () => {
  it.each([
    ["/tasks/abc123", "a task's transcript"],
    ["/debug/components/playback", "the transcript playback page"],
  ])("leaves %s to its own scroller", (pathname) => {
    expect(at(pathname)).toBe(false);
  });

  // Switching between them is the case that surfaced this: same pathname, and
  // the offset still arrives from the scenario before it.
  it("leaves playback alone whichever scenario is being shown", () => {
    expect(at("/debug/components/playback")).toBe(false);
  });

  it.each([
    ["/settings/debug", "a settings page"],
    ["/projects/xyz", "a project"],
    ["/debug/components/chat-stream", "a sibling debug page"],
  ])("keeps element restoration for %s", (pathname) => {
    expect(at(pathname)).toBe(true);
  });
});

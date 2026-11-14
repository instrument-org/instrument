import type { SiteCaptureSetting } from "@/shared/browser";

import type { GuestRecord } from "./guest-registry";

import { personJustUsedTab } from "./external-app-links";

/**
 * What to do with a page's request for the microphone or camera:
 *
 * - `blocked`: the site was told never for one of them, so it gets nothing
 *   and nobody is asked.
 * - `allow`: a tab's guest a person is looking at (shown in its slot, in the
 *   focused window) whose site was told always for everything it asks, or
 *   whose origin was let have them in this guest already.
 * - `ask`: the same tab, clicked, tapped or typed in by a person within the
 *   last few seconds, as for full screen. An agent's CDP click is left out of
 *   that record of input (`noteUserInput`), so an agent never raises the ask.
 * - `refuse`: anything else, which the person can still allow from the mark.
 */
export function mediaDecision(
  guest: {
    record: Pick<GuestRecord, "role" | "userInputAt"> | undefined;
    /** Whether a slot in the guest's window shows it, as the renderer pool last reported. */
    shown: boolean;
    windowFocused: boolean;
    /** Whether this guest already let the asking page's origin have them. */
    grantedBefore: boolean;
    /** What the site was told for each device the page asks for. */
    settings: readonly SiteCaptureSetting[];
  },
  now = Date.now(),
): "allow" | "ask" | "blocked" | "refuse" {
  if (guest.settings.includes("block")) {
    return "blocked";
  }
  if (
    guest.record?.role !== "webview" ||
    !guest.shown ||
    !guest.windowFocused
  ) {
    return "refuse";
  }
  if (
    guest.grantedBefore ||
    (guest.settings.length > 0 &&
      guest.settings.every((setting) => setting === "allow"))
  ) {
    return "allow";
  }
  return personJustUsedTab(guest.record, now) ? "ask" : "refuse";
}

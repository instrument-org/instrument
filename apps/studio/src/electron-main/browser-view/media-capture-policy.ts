import type { GuestRecord } from "./guest-registry";

import { personJustUsedTab } from "./external-app-links";

/**
 * Whether a page may use the microphone or camera (`getUserMedia`). The first
 * time, only a tab's guest a person is looking at and just used may: shown in
 * its slot, in the focused window, clicked, tapped or typed in within the last
 * few seconds, as for full screen. An agent's CDP click is left out of that
 * record of input (`noteUserInput`), so an agent never turns either on.
 *
 * Once a page's origin was granted in a guest, it may ask again while the tab
 * is shown in the focused window, without a fresh click: a call page asks
 * again when it switches devices or comes back from mute after a delay.
 */
export function mayCaptureMedia(
  guest: {
    record: Pick<GuestRecord, "role" | "userInputAt"> | undefined;
    /** Whether a slot in the guest's window shows it, as the renderer pool last reported. */
    shown: boolean;
    windowFocused: boolean;
    /** Whether this guest already granted the asking page's origin. */
    grantedBefore: boolean;
  },
  now = Date.now(),
): boolean {
  if (guest.record?.role !== "webview" || !guest.shown) {
    return false;
  }
  if (!guest.windowFocused) {
    return false;
  }
  return guest.grantedBefore || personJustUsedTab(guest.record, now);
}

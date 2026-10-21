import type { GuestRecord } from "./guest-registry";

import { personJustUsedTab } from "./external-app-links";

/**
 * Whether a page may go into HTML full screen (a video's full-screen button,
 * `requestFullscreen()`), which takes the whole app window into full screen
 * and, on macOS, onto a Space of its own. Only a tab's guest a person is
 * looking at and just used may: the guest a slot in its window shows rather
 * than parks, in the focused window, clicked, tapped or typed in within the
 * last few seconds. Chromium's own user-gesture check counts an agent's CDP
 * click as a gesture; the guest's record of input leaves it out (see
 * `noteUserInput`).
 */
export function mayEnterFullScreen(
  guest: {
    record: Pick<GuestRecord, "role" | "userInputAt"> | undefined;
    /** Whether a slot in the guest's window shows it, as the renderer pool last reported. */
    shown: boolean;
    windowFocused: boolean;
  },
  now = Date.now(),
): boolean {
  return (
    guest.shown && guest.windowFocused && personJustUsedTab(guest.record, now)
  );
}

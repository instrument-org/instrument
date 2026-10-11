import type { InputEvent } from "electron";

import type { GuestRecord } from "./guest-registry";

/**
 * How long a click or key press lets a page hand a link to another app, the
 * same few seconds a browser's transient user activation lasts. Long enough
 * for a launch page that loads after the click and fires its `slack://` link
 * on load; short enough that a page left open cannot do it later on its own.
 */
export const USER_INPUT_WINDOW_MS = 5000;

const ACTIVATING_INPUT = new Set<InputEvent["type"]>([
  "gestureTap",
  "keyDown",
  "mouseDown",
  "rawKeyDown",
  "touchStart",
]);

/**
 * Records a person's click, tap or key press in a guest. `byAgent` is whether
 * an agent's CDP command owns the guest right now: its dispatched input
 * reaches the guest as the same events a person's does, and counting it would
 * let a page the agent clicks open apps on the user's computer.
 */
export function noteUserInput(
  record: Pick<GuestRecord, "userInputAt"> | undefined,
  type: InputEvent["type"],
  byAgent: boolean,
  now = Date.now(),
) {
  if (record && !byAgent && ACTIVATING_INPUT.has(type)) {
    record.userInputAt = now;
  }
}

/**
 * Whether a page may offer a link the browser cannot open itself (`slack://`,
 * `zoommtg://`, any scheme an installed app registered) to the app that
 * handles it, which `askToOpenInAnotherApp` then puts to the person. Any
 * scheme goes, but only from a tab's guest and only just after a person used
 * it. Electron drops the request's user gesture before the session's
 * permission handler sees it, so the guest's own record of input is what
 * stands in for one.
 */
export function mayOpenInAnotherApp(
  record: Pick<GuestRecord, "role" | "userInputAt"> | undefined,
  now = Date.now(),
): boolean {
  return (
    record?.role === "webview" &&
    record.userInputAt > 0 &&
    now - record.userInputAt <= USER_INPUT_WINDOW_MS
  );
}

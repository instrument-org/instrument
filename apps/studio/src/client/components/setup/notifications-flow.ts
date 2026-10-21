/**
 * Where the notifications step stands, as a reducer the page drives, so
 * each way through is checked without the system's prompt.
 *
 * `ask` offers Allow; `asking` waits on the prompt; `sent` waits on a test
 * notification's click (any of them, since a click on an earlier one says
 * as much as one on the latest); `allowed` has seen it; `off` is the system
 * saying no. Only `allowed` makes Continue the main button: everywhere else
 * it is quiet, a skip that is always there.
 */
export type NotificationsState = "allowed" | "ask" | "asking" | "off" | "sent";

export type NotificationsEvent =
  | { granted: boolean; type: "answered" }
  | { type: "allow" }
  | { type: "clicked" };

export function notificationsStep(
  state: NotificationsState,
  event: NotificationsEvent,
): NotificationsState {
  switch (event.type) {
    case "allow": {
      return state === "ask" ? "asking" : state;
    }
    case "answered": {
      if (state !== "asking") {
        return state;
      }
      return event.granted ? "sent" : "off";
    }
    case "clicked": {
      return state === "sent" ? "allowed" : state;
    }
  }
}

/** The footer's Continue for a state. */
export function continueFor(state: NotificationsState): "primary" | "quiet" {
  return state === "allowed" ? "primary" : "quiet";
}

/**
 * How a sign-in that ran in the person's browser ended, in the one vocabulary
 * the page the browser lands on, the button that started it, and the window
 * all speak: Google's sign-in to Instrument and a ChatGPT account's alike.
 */
export type SignInOutcome =
  /** Given up in the app, or replaced by a newer sign-in. */
  | "canceled"
  /** The person said no on the service's own page. */
  | "declined"
  /** The browser came back to a sign-in nobody was waiting for, or one it did not match. */
  | "expired"
  /** The service said yes and the rest went wrong. */
  | "failed"
  /** Signed in to ChatGPT with plan access left unchecked: nothing to run on yet. */
  | "plan-off"
  /** Signed in, and ready. */
  | "signed-in";

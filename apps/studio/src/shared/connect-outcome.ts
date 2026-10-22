/** The ways in setup and the Add a provider sheet offer by signing in. */
export type ConnectProvider = "chatgpt" | "claude" | "grok" | "instrument";

/**
 * How connecting a provider ended, sign-in and account check together, in
 * the one vocabulary every surface draws from: setup, the Add a provider
 * sheet, Settings and the notes above the reply box. Network trouble is not
 * an answer of its own; the window's network pill says it.
 */
export type ConnectOutcome =
  /** Given up in the app, or replaced by a newer attempt. */
  | { kind: "canceled" }
  /** The person said no on the service's own page. */
  | { kind: "declined" }
  /** Anything the flow can't name, with the cause for developer mode. */
  | { kind: "failed"; message: string }
  /**
   * Signed in, and the plan can't be used here: a free plan, one that ended,
   * or a work account that turns off other apps (ChatGPT reports these the
   * same way), or a Grok account without an eligible paid plan.
   */
  | { kind: "no-plan"; plan?: string }
  /** Signed in, and the plan hit its limit; usage comes back at `resetsAt`. */
  | { kind: "out-of-usage"; resetsAt?: string }
  /** Ready to run on. */
  | { kind: "ready"; plan?: string }
  /** The service's sign-in is gone or was never finished. */
  | { kind: "signed-out" }
  /** Instrument wouldn't create an account for that address. */
  | { kind: "sign-up-refused" }
  /** The account check didn't answer before its deadline. */
  | { kind: "timed-out" };

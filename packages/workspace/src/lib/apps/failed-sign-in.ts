import { APP_NAME } from "@instrument-org/shared";

/** How a sign-in of an app's own did not connect. */
export type FailedSignIn = "failed" | "refused";

type Offer = "fix" | "retry";

/** The words on each button, as the sign-in card shows them and the agent names them. */
export const FAILED_SIGN_IN_LABELS = {
  fix: `Fix with ${APP_NAME}`,
  retry: "Try again",
} as const satisfies Record<Offer, string>;

/**
 * What the sign-in card has to press after a sign-in that did not connect.
 * The card and the note the agent is woken with both read it, so the agent
 * names the buttons the user sees. A refusal has no other try: the same
 * sign-in meets the same refusal, in any browser.
 */
export const FAILED_SIGN_IN_OFFERS: Record<FailedSignIn, readonly Offer[]> = {
  failed: ["fix", "retry"],
  refused: ["fix"],
};

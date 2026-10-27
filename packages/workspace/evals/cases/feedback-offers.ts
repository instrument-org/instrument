/**
 * Does the agent keep `offer_feedback` for problems in Instrument itself?
 *
 * The user asks for a page on a host that does not exist, so the fetch fails
 * the way a site that is down does. That is the site's problem, not the app's,
 * and the agent should say so without offering to report it. Scored: no
 * `offer_feedback` call at all.
 *
 * The other side, offering when a tool of the app's own breaks, has no case:
 * the harness has no way to make one break on cue.
 */
import { type Assertion, defineEval } from "../harness";

const neverOffers: Assertion = {
  check: ({ sessions }) => {
    const text = "never offered to report a site that is down";
    const offers = sessions.flatMap((session) =>
      session.messages.flatMap((message) =>
        message.parts.filter((part) => part.type === "tool-offer_feedback"),
      ),
    );
    return {
      evidence:
        offers
          .map((part) => JSON.stringify(part.input ?? {}).slice(0, 200))
          .join(" | ") || "no offer",
      passed: offers.length === 0,
      text,
    };
  },
  text: "never offered to report a site that is down",
};

export const FEEDBACK_OFFER_EVALS = [
  defineEval({
    assertions: [neverOffers],
    kind: "chat",
    name: "feedback-offer-site-down",
    prompt:
      "What plans are listed on https://pricing.helpdesk-competitor.invalid/plans? Just tell me the names.",
  }),
];

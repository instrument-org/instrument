import { type SetupStep } from "@/client/components/onboarding/setup/flow";
import { type RPCOutput } from "@/client/rpc/client";

/** What the plan pages read off billing, and the billing calls they make. */

type Offer = RPCOutput["billing"]["offer"];
type OfferPlan = Offer["plans"][number];
type Status = RPCOutput["billing"]["status"];

const DAY_MS = 86_400_000;

/** The beta testers' thank-you: `months` of `plan` for free. */
export type BetaOffer = NonNullable<Offer["beta"]>;

/**
 * The beta offer the API makes this account, or null for none (an API that
 * predates the field sends nothing). Whether one is made is the API's call
 * alone; this only reads what it says.
 */
export function readBetaOffer(offer: Offer | undefined): BetaOffer | null {
  return offer?.beta ?? null;
}

/**
 * Where Welcome back's Get started goes: the beta offer when the API makes
 * one, the plans for anyone signed in with an Instrument account, and the
 * ways in (ChatGPT, Claude, a key, or Google) for everyone else.
 */
export function welcomeBackNext({
  beta,
  isSignedIn,
}: {
  beta: BetaOffer | null;
  isSignedIn: boolean;
}): SetupStep {
  if (beta) {
    return "beta-offer";
  }
  return isSignedIn ? "plans" : "welcome";
}

/**
 * When the trial ends: the date billing has for a trial already running,
 * else the trial's days counted from now.
 */
export function trialEndDate({
  days,
  now,
  status,
}: {
  days: number;
  now: Date;
  status: Status | undefined;
}) {
  if (
    status?.plan === "trial" &&
    status.trial.state === "active" &&
    status.trial.endsAt
  ) {
    const endsAt = new Date(status.trial.endsAt);
    if (!Number.isNaN(endsAt.getTime())) {
      return endsAt;
    }
  }
  return new Date(now.getTime() + days * DAY_MS);
}

/** How many of the usage meter's four steps a plan fills. */
export function meterSteps(plan: OfferPlan) {
  return Math.min(4, Math.max(1, Math.round(plan.allowance.multiple)));
}

/** Whether a plan is the one for heavy use: more than the standard allowance. */
export function isHeavyPlan(plan: OfferPlan) {
  return plan.allowance.multiple > 1;
}

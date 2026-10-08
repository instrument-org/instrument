import { type SetupStep } from "@/client/components/onboarding/setup/flow";
import { type RPCOutput } from "@/client/rpc/client";
import { z } from "zod";

/**
 * What the plan pages read off billing, and the seams where they call billing
 * routes that do not exist yet. Each seam is one function here, so wiring the
 * real route is a change to this file alone.
 */

type Offer = RPCOutput["billing"]["offer"];
type OfferPlan = Offer["plans"][number];
type Status = RPCOutput["billing"]["status"];

const DAY_MS = 86_400_000;

const BetaOfferSchema = z.object({ months: z.number(), plan: z.string() });

/** The beta testers' thank-you: `months` of `plan` for free. */
export type BetaOffer = z.output<typeof BetaOfferSchema>;

/**
 * The beta offer the API makes this account, or null for none. Whether one
 * is made is the API's call alone; this only reads what it says.
 *
 * Seam: the offer does not carry `beta` yet, so this reads null until the
 * billing contract adds the field.
 */
export function readBetaOffer(offer: Offer | undefined): BetaOffer | null {
  if (!offer || !("beta" in offer)) {
    return null;
  }
  const parsed = BetaOfferSchema.safeParse(offer.beta);
  return parsed.success ? parsed.data : null;
}

/**
 * Starts the free trial when the person picks it, so its end date is set
 * from now.
 *
 * Seam: there is no `billing.startTrial` route yet, so this does nothing and
 * the trial starts on the first request to Instrument's AI, as it always has.
 */
export async function startTrial(_plan: string): Promise<void> {
  // Replaced by `await rpcClient.billing.startTrial.call({ plan })`.
}

/**
 * Whether Checkout can open on the beta offer's $0 price.
 *
 * Seam: `billing.openCheckout` takes no `offer` yet, and `usePlanCheckout`
 * passes none, so Accept would open Checkout at full price. It stays off
 * until both take `offer: "beta"`.
 */
export const CAN_CHECKOUT_BETA_OFFER = false;

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

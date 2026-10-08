import { type RPCOutput } from "@/client/rpc/client";

type Offer = RPCOutput["billing"]["offer"];
type Status = RPCOutput["billing"]["status"];

/**
 * Which plan step onboarding shows, if any: `trial` cards (Start free trial
 * on each) for an account the offer still has a trial for, `subscribe` cards
 * for one it has none for (the trial used, trials paused, or a card needed),
 * and none at all for someone the step has nothing to offer.
 *
 * No step for: no Instrument account (nothing to buy with), a ChatGPT or
 * Claude account (it already runs on the plan they pay for), a subscription of any
 * kind (Settings handles a failed payment), or a trial already running.
 */
export type OnboardingPlanStep = "subscribe" | "trial" | null;

export function onboardingPlanStep({
  hasSubscriptionAccount,
  isSignedIn,
  offer,
  status,
}: {
  hasSubscriptionAccount: boolean;
  isSignedIn: boolean;
  offer: Offer;
  status: Status;
}): OnboardingPlanStep {
  if (!isSignedIn || hasSubscriptionAccount || offer.plans.length === 0) {
    return null;
  }
  if (status.subscription) {
    return null;
  }
  if (status.plan === "trial" && status.trial.state === "active") {
    return null;
  }
  return offer.trial?.available === true ? "trial" : "subscribe";
}

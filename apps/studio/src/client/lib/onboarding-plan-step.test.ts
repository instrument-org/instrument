import { type RPCOutput } from "@/client/rpc/client";
import { describe, expect, it } from "vitest";

import { isInAppOnboardingPending } from "@/shared/in-app-onboarding";
import { onboardingPlanStep } from "./onboarding-plan-step";

type Offer = RPCOutput["billing"]["offer"];
type Status = RPCOutput["billing"]["status"];

const plan = (key: string, multiple: number) => ({
  allowance: { multiple, windows: [] },
  description: null,
  features: [],
  key,
  name: key,
  price: { currency: "usd", interval: "month", unitAmount: 1000 * multiple },
});
const offer = (trial: Offer["trial"]): Offer => ({
  offerVersion: "v",
  plans: [plan("basic", 1), plan("pro", 4)],
  trial,
});
const TRIAL_OFFERED = offer({ available: true, cardRequired: false, days: 7 });
const TRIAL_USED = offer({ available: false, cardRequired: false, days: 7 });
const TRIAL_PAUSED = offer(null);
const CARD_REQUIRED = offer({ available: true, cardRequired: true, days: 7 });

const fresh: Status = {
  canSubscribe: true,
  plan: "trial",
  trial: { state: "available" },
  windows: [],
};
const ended: Status = {
  canSubscribe: true,
  plan: "none",
  trial: { state: "ended" },
  windows: [],
};
const running: Status = {
  ...fresh,
  trial: { percentUsed: 10, state: "active" },
};
const subscribed: Status = {
  canSubscribe: false,
  plan: "basic",
  subscription: { cancelAtPeriodEnd: false, status: "active" },
  trial: { state: "ended" },
  windows: [],
};

describe("onboardingPlanStep", () => {
  it.each([
    {
      expected: "trial",
      name: "a new account",
      offer: TRIAL_OFFERED,
      status: fresh,
    },
    {
      expected: "trial",
      name: "a card-required trial",
      offer: CARD_REQUIRED,
      status: fresh,
    },
    {
      expected: "subscribe",
      name: "a used trial",
      offer: TRIAL_USED,
      status: ended,
    },
    {
      expected: "subscribe",
      name: "trials paused",
      offer: TRIAL_PAUSED,
      status: fresh,
    },
    {
      expected: null,
      name: "a subscriber",
      offer: TRIAL_USED,
      status: subscribed,
    },
    {
      expected: null,
      name: "a trial already running",
      offer: TRIAL_USED,
      status: running,
    },
  ])("$name: $expected", ({ expected, offer: theOffer, status }) => {
    expect(
      onboardingPlanStep({
        hasSubscriptionAccount: false,
        isSignedIn: true,
        offer: theOffer,
        status,
      }),
    ).toBe(expected);
  });

  it("skips the step for someone on their ChatGPT or Claude account", () => {
    expect(
      onboardingPlanStep({
        hasSubscriptionAccount: true,
        isSignedIn: true,
        offer: TRIAL_OFFERED,
        status: fresh,
      }),
    ).toBeNull();
  });

  it("skips the step without an Instrument account", () => {
    expect(
      onboardingPlanStep({
        hasSubscriptionAccount: false,
        isSignedIn: false,
        offer: TRIAL_OFFERED,
        status: fresh,
      }),
    ).toBeNull();
  });
});

describe("isInAppOnboardingPending", () => {
  it.each([
    {
      completedVersion: 0,
      expected: true,
      name: "an existing beta user after updating",
      setUp: true,
    },
    {
      completedVersion: 0,
      expected: false,
      name: "a new user still in the sign-in window",
      setUp: false,
    },
    {
      completedVersion: 2,
      expected: false,
      name: "someone who finished it",
      setUp: true,
    },
  ])("$name: $expected", ({ completedVersion, expected, setUp }) => {
    expect(
      isInAppOnboardingPending({
        completedVersion,
        hasCompletedProviderSetup: setUp,
        skip: false,
      }),
    ).toBe(expected);
  });

  it("never shows for a run that skips onboarding", () => {
    expect(
      isInAppOnboardingPending({
        completedVersion: 0,
        hasCompletedProviderSetup: true,
        skip: true,
      }),
    ).toBe(false);
  });
});

import { type RPCOutput } from "@/client/rpc/client";
import { describe, expect, it } from "vitest";

import {
  accountNotice,
  allowanceLabel,
  allowanceMeter,
  canStartTrial,
  checkoutTrialLine,
  describeWhen,
  featurePause,
  freeAllowancePause,
  hasNoPlan,
  isAccessRevoked,
  isTrialHeldBack,
  noticeCopy,
  planCardAction,
  refusalNotice,
  stopLineText,
  subscriptionPhaseLine,
  upgradePlan,
  usageWarning,
  usageWarningText,
} from "./billing";

type Offer = RPCOutput["billing"]["offer"];
type Status = RPCOutput["billing"]["status"];

const windows = [
  { anchor: "first_use", duration: "PT5H", key: "5h" },
  { anchor: "first_use", duration: "P7D", key: "week" },
  { anchor: "billing_cycle", key: "month" },
];

const offer: Offer = {
  offerVersion: "v1",
  plans: [
    {
      allowance: { multiple: 1, windows },
      description: null,
      features: [],
      key: "basic",
      name: "Basic",
      price: { currency: "usd", interval: "month", unitAmount: 1000 },
    },
    {
      allowance: { multiple: 4, windows },
      description: null,
      features: [],
      key: "pro",
      name: "Pro",
      price: { currency: "usd", interval: "month", unitAmount: 4000 },
    },
  ],
  trial: { available: true, cardRequired: false, days: 7 },
};

// Local time throughout, so the words do not depend on the machine's zone.
const NOW = new Date(2026, 9, 5, 12, 0);
const LATER = NOW.getTime() + 60_000;

const trialActive: Status = {
  canSubscribe: true,
  plan: "trial",
  trial: {
    endsAt: new Date(2026, 9, 11, 9, 0).toISOString(),
    percentUsed: 45,
    state: "active",
  },
  windows: [],
};
const trialEnded: Status = {
  canSubscribe: true,
  plan: "trial",
  trial: { state: "ended" },
  windows: [],
};
const noPlan: Status = {
  canSubscribe: true,
  plan: "none",
  trial: { state: "ended" },
  windows: [],
};
const RESET = new Date(2026, 10, 4, 9, 0);
const onFree = (paused = false): Status => ({
  canSubscribe: true,
  features: {
    decisions: paused
      ? {
          available: false,
          code: "usage-limit-exceeded",
          resetsAt: RESET.toISOString(),
        }
      : { available: true },
    models: {
      available: false,
      code: "subscription-required",
      reason: "trial-available",
    },
    search: paused
      ? {
          available: false,
          code: "usage-limit-exceeded",
          resetsAt: RESET.toISOString(),
        }
      : { available: true },
  },
  plan: "free",
  trial: { state: "available" },
  windows: [{ key: "free", percentUsed: paused ? 100 : 5 }],
});
const onPlan = (
  plan: string,
  overrides: Partial<NonNullable<Status["subscription"]>> = {},
  percents: number[] = [20, 10, 5],
): Status => ({
  canSubscribe: false,
  plan,
  subscription: {
    cancelAtPeriodEnd: false,
    currentPeriodEnd: new Date(2026, 10, 5).toISOString(),
    status: "active",
    ...overrides,
  },
  trial: { state: "ended" },
  windows: ["5h", "week", "month"].map((key, index) => ({
    key,
    percentUsed: percents[index] ?? 0,
    resetsAt: new Date(2026, 9, 5, 15, 40 + index).toISOString(),
  })),
});

describe("describeWhen", () => {
  it.each([
    { at: new Date(2026, 9, 5, 15, 40), words: "at 3:40 PM" },
    { at: new Date(2026, 9, 6, 9, 12), words: "tomorrow at 9:12 AM" },
    { at: new Date(2026, 9, 9, 9, 12), words: "Friday at 9:12 AM" },
    { at: new Date(2026, 10, 5, 9, 0), words: "November 5" },
    { at: new Date(2027, 0, 5, 9, 0), words: "January 5, 2027" },
  ])("$words", ({ at, words }) => {
    expect(describeWhen(at, NOW)).toBe(words);
  });
});

describe("refusalNotice", () => {
  const notice = (
    refusal: Parameters<typeof refusalNotice>[0]["refusal"],
    status: Status | undefined,
    statusReadAt = LATER,
  ) =>
    refusalNotice({
      now: NOW,
      offer,
      refusal,
      refusedAt: NOW,
      status,
      statusReadAt,
    });

  it.each([
    {
      expected: "trial-ended",
      name: "a spent trial",
      reason: "trial-ended",
      status: trialEnded,
    },
    {
      expected: "trial-ended",
      name: "a trial used before",
      reason: "trial-used",
      status: noPlan,
    },
    {
      expected: "plan-required",
      name: "no plan",
      reason: "no-plan",
      status: noPlan,
    },
    {
      expected: "plan-required",
      name: "trials paused",
      reason: "trial-paused",
      status: noPlan,
    },
    {
      expected: "payment-failed",
      name: "a renewal that failed",
      reason: "no-plan",
      status: onPlan("basic", { status: "past_due" }),
    },
    {
      expected: "payment-failed",
      name: "a refusal that says so",
      reason: "payment-failed",
      status: undefined,
    },
    {
      expected: "access-revoked",
      name: "access revoked after a dispute",
      reason: "access-revoked",
      status: noPlan,
    },
    {
      expected: "resumed",
      name: "a plan bought since",
      reason: "trial-ended",
      status: onPlan("basic"),
    },
  ])(
    "subscription-required, $name: $expected",
    ({ expected, reason, status }) => {
      expect(
        notice({ code: "subscription-required", reason }, status)?.kind,
      ).toBe(expected);
    },
  );

  it.each([
    {
      name: "a plan bought",
      reason: "trial-ended",
      title: "You're subscribed.",
    },
    {
      name: "a failed payment fixed",
      reason: "payment-failed",
      title: "Your payment went through.",
    },
    {
      name: "access restored",
      reason: "access-revoked",
      title: "Instrument is available again.",
    },
  ])("says what changed once $name lifts the refusal", ({ reason, title }) => {
    const resumed = notice(
      { code: "subscription-required", reason },
      onPlan("basic"),
    );
    expect(resumed && noticeCopy(resumed, NOW).title).toBe(title);
  });

  // The trial isn't over, so the way forward is a plan rather than waiting.
  it.each(["trial-capacity", "trial-paused"])(
    "offers the plans when a trial can't start (%s)",
    (reason) => {
      const held = notice({ code: "subscription-required", reason }, noPlan);
      expect(held && noticeCopy(held, NOW)).toMatchInlineSnapshot(`
        {
          "action": {
            "kind": "choose-plan",
            "label": "Choose a plan",
          },
          "title": "Free trials aren't available right now.",
        }
      `);
    },
  );

  it("keeps the trial ended when its last request would have gone over", () => {
    expect(
      notice(
        { code: "subscription-required", reason: "trial-ended" },
        {
          ...trialActive,
          trial: { ...trialActive.trial, percentUsed: 85 },
        },
      )?.kind,
    ).toBe("trial-ended");
  });

  it("does not take a status read before the refusal as the account now", () => {
    expect(
      notice(
        { code: "subscription-required", reason: "trial-ended" },
        trialActive,
        NOW.getTime() - 1,
      )?.kind,
    ).toBe("trial-ended");
  });

  it("offers the bigger plan to someone on the smaller one at a limit", () => {
    const limit = notice(
      {
        code: "usage-limit-exceeded",
        resetsAt: new Date(2026, 9, 5, 15, 40).toISOString(),
        window: "5h",
      },
      onPlan("basic", {}, [100, 40, 20]),
    );
    expect(limit).toMatchObject({
      kind: "plan-limit",
      upgradeTo: { key: "pro" },
    });
    expect(limit && noticeCopy(limit, NOW)).toMatchInlineSnapshot(`
      {
        "action": {
          "kind": "upgrade",
          "label": "Upgrade",
        },
        "line": "It resets at 3:40 PM.",
        "title": "You've reached your plan's limit for now.",
      }
    `);
  });

  it("offers nothing but the reset on the biggest plan", () => {
    const limit = notice(
      {
        code: "usage-limit-exceeded",
        resetsAt: new Date(2026, 9, 12, 9, 12).toISOString(),
        window: "week",
      },
      onPlan("pro", {}, [30, 100, 20]),
    );
    expect(limit && noticeCopy(limit, NOW)).toMatchInlineSnapshot(`
      {
        "line": "It resets October 12.",
        "title": "You've reached your plan's limit for now.",
      }
    `);
  });

  it("turns into Continue once the window has reset", () => {
    expect(
      notice(
        {
          code: "usage-limit-exceeded",
          resetsAt: new Date(2026, 9, 5, 11, 0).toISOString(),
          window: "5h",
        },
        undefined,
      )?.kind,
    ).toBe("resumed");
  });

  it("has nothing to say about too many tasks at once", () => {
    expect(notice({ code: "concurrency-limit" }, trialActive)).toBeUndefined();
  });
});

it("offers support rather than a plan when access was revoked", () => {
  expect(noticeCopy({ kind: "access-revoked" }, NOW)).toMatchInlineSnapshot(`
    {
      "action": {
        "kind": "contact-support",
        "label": "Contact support",
      },
      "line": "Get in touch and we'll sort it out.",
      "title": "Instrument isn't available on this account.",
    }
  `);
});

describe("accountNotice", () => {
  it.each([
    { expected: undefined, name: "a trial under way", status: trialActive },
    {
      expected: undefined,
      name: "a trial not started",
      status: { ...noPlan, trial: { state: "available" } } satisfies Status,
    },
    { expected: "trial-ended", name: "a trial over", status: trialEnded },
    { expected: "trial-ended", name: "no plan after a trial", status: noPlan },
    {
      expected: "payment-failed",
      name: "a failed payment",
      status: onPlan("none", { plan: "basic", status: "past_due" }),
    },
    { expected: undefined, name: "a plan with room", status: onPlan("basic") },
    {
      expected: "plan-required",
      name: "the free allowance before the trial",
      status: onFree(),
    },
    {
      expected: "trial-ended",
      name: "the free allowance after the trial",
      status: { ...onFree(), trial: { state: "ended" } } satisfies Status,
    },
    {
      expected: "plan-limit",
      name: "a spent window",
      status: onPlan("basic", {}, [100, 40, 10]),
    },
  ])("reads $name as $expected", ({ expected, status }) => {
    expect(accountNotice(status, offer)?.kind).toBe(expected);
  });
});

describe("stopLineText", () => {
  it.each([
    {
      line: "Stopped: your free trial has ended.",
      refusal: { code: "subscription-required", reason: "trial-ended" },
    },
    {
      line: "Stopped: Instrument needs a plan.",
      refusal: { code: "subscription-required", reason: "no-plan" },
    },
    {
      line: "Stopped: free trials aren't available right now.",
      refusal: { code: "subscription-required", reason: "trial-capacity" },
    },
    {
      line: "Stopped: free trials aren't available right now.",
      refusal: { code: "subscription-required", reason: "trial-paused" },
    },
    {
      line: "Stopped: your payment didn't go through.",
      refusal: { code: "subscription-required", reason: "payment-failed" },
    },
    {
      line: "Stopped: you've reached your plan's limit for now.",
      refusal: { code: "usage-limit-exceeded" },
    },
    {
      line: "Stopped: too many of your tasks were running at once.",
      refusal: { code: "concurrency-limit" },
    },
    {
      line: "Stopped: Instrument isn't available on this account.",
      refusal: { code: "subscription-required", reason: "access-revoked" },
    },
    { line: undefined, refusal: { code: "meter-unavailable" } },
  ])("$refusal.code $refusal.reason", ({ line, refusal }) => {
    expect(stopLineText(refusal)).toBe(line);
  });
});

describe("planCardAction", () => {
  const [standard, plus] = offer.plans;
  it.each([
    { expected: "subscribe", name: "no plan", plan: standard, status: noPlan },
    {
      expected: "trial",
      name: "a new account in setup",
      plan: standard,
      status: undefined,
      trial: true,
    },
    {
      expected: "current",
      name: "the plan they are on",
      plan: standard,
      status: onPlan("basic"),
    },
    {
      expected: "switch",
      name: "the other plan",
      plan: plus,
      status: onPlan("basic"),
    },
    {
      expected: "keep",
      name: "the plan they are on while a downgrade waits",
      plan: plus,
      status: onPlan("pro", {
        scheduledChange: { at: NOW.toISOString(), plan: "basic" },
      }),
    },
    {
      expected: "scheduled",
      name: "the plan a waiting downgrade moves to",
      plan: standard,
      status: onPlan("pro", {
        scheduledChange: { at: NOW.toISOString(), plan: "basic" },
      }),
    },
  ])("$name: $expected", ({ expected, plan, status, trial }) => {
    expect(plan && planCardAction(plan, status, { trial })).toBe(expected);
  });

  it("names allowance against the first plan", () => {
    expect(offer.plans.map((plan) => allowanceLabel(plan))).toEqual([
      "Standard",
      "4× Standard",
    ]);
  });

  it.each([
    { expected: [1, 4], multiples: [1, 4] },
    { expected: [1, 2, 4], multiples: [1, 2, 4] },
    { expected: [1], multiples: [1] },
    { expected: [1, 8], multiples: [1, 20] },
    { expected: [2, 3], multiples: [2, 3] },
  ])(
    "fills a meter of $multiples by share of the biggest",
    ({ expected, multiples }) => {
      const plans = multiples.map((multiple) => ({
        allowance: { multiple, windows },
        description: null,
        features: [],
        key: String(multiple),
        name: String(multiple),
        price: null,
      }));
      expect(plans.map((plan) => allowanceMeter(plan, plans))).toEqual(
        expected.map((filled) => ({
          filled,
          segments: Math.min(Math.ceil(Math.max(...multiples)), 8),
        })),
      );
    },
  );

  it("has no plan above the biggest", () => {
    expect(upgradePlan(offer, onPlan("pro"))).toBeUndefined();
    expect(upgradePlan(offer, onPlan("basic"))?.key).toBe("pro");
  });
});

describe("usageWarning", () => {
  it("says nothing under 80%", () => {
    expect(usageWarning(trialActive)).toBeUndefined();
    expect(usageWarning(onPlan("basic", {}, [79, 50, 10]))).toBeUndefined();
  });

  it("warns at 80% of the trial", () => {
    const warning = usageWarning({
      ...trialActive,
      trial: { ...trialActive.trial, percentUsed: 82.4 },
    });
    expect(warning && usageWarningText(warning, NOW)).toMatchInlineSnapshot(
      `"82% of your free trial is used. It ends October 11 or when it runs out."`,
    );
  });

  it("warns about the fullest window at 80% or more", () => {
    const warning = usageWarning(onPlan("basic", {}, [81, 93, 10]));
    expect(warning).toMatchObject({ kind: "window", window: "week" });
    expect(warning && usageWarningText(warning, NOW)).toMatchInlineSnapshot(
      `"You've used 93% of your plan for this week. It resets at 3:41 PM."`,
    );
  });

  it("leaves a full window to the refusal notice", () => {
    expect(usageWarning(onPlan("basic", {}, [100, 50, 10]))).toBeUndefined();
  });

  it("keys a warning by its period, so dismissing it lasts until the next", () => {
    const first = usageWarning(onPlan("basic", {}, [85, 50, 10]));
    const second = usageWarning(onPlan("basic", {}, [90, 50, 10]));
    expect(first?.key).toBe(second?.key);
  });
});

describe("isTrialHeldBack", () => {
  const trialAvailable: Status = {
    canSubscribe: true,
    plan: "trial",
    trial: { state: "available" },
    windows: [],
  };

  it.each([
    { held: true, name: "an offer with no trial", trial: null },
    {
      held: false,
      name: "a trial offered",
      trial: { available: true, cardRequired: false, days: 7 },
    },
  ])("$name: $held", ({ held, trial }) => {
    expect(isTrialHeldBack(trialAvailable, { ...offer, trial })).toBe(held);
  });

  it("leaves a trial already taken alone", () => {
    expect(isTrialHeldBack(trialActive, { ...offer, trial: null })).toBe(false);
  });
});

describe("isAccessRevoked", () => {
  it.each([
    {
      expected: true,
      name: "a paid subscription with no plan",
      status: { ...onPlan("basic"), plan: "none" },
    },
    {
      expected: false,
      name: "a failed payment",
      status: { ...onPlan("basic", { status: "past_due" }), plan: "none" },
    },
    {
      expected: false,
      name: "a stopped Stripe trial",
      status: { ...onPlan("basic", { status: "paused" }), plan: "none" },
    },
    { expected: false, name: "a plan in effect", status: onPlan("basic") },
    { expected: false, name: "no subscription", status: noPlan },
    {
      expected: true,
      name: "no subscription left and Checkout refused",
      status: { ...noPlan, canSubscribe: false },
    },
  ])("$name: $expected", ({ expected, status }) => {
    expect(isAccessRevoked(status)).toBe(expected);
  });
});

describe("checkoutTrialLine", () => {
  const intro = {
    available: true,
    cardRequired: true,
    days: 7,
    intro: { months: 1, price: { currency: "usd", unitAmount: 100 } },
    mode: "intro" as const,
  };

  it.each([
    {
      expected: "Your first month is $1.",
      label: "an intro month",
      trial: intro,
    },
    {
      expected: "Your first 3 months are $1 each.",
      label: "intro months",
      trial: { ...intro, intro: { ...intro.intro, months: 3 } },
    },
    {
      expected:
        "Free for 7 days. You won't be charged if you cancel before it ends.",
      label: "a card trial",
      trial: { ...intro, intro: undefined, mode: "card" as const },
    },
    {
      expected: undefined,
      label: "a no-card trial",
      trial: {
        available: true,
        cardRequired: false,
        days: 7,
        mode: "no_card" as const,
      },
    },
    {
      expected: undefined,
      label: "a trial already used",
      trial: { ...intro, available: false },
    },
  ])("$label", ({ expected, trial }) => {
    expect(checkoutTrialLine({ ...offer, trial })).toBe(expected);
  });

  it("feeds the card-required notice", () => {
    const notice = refusalNotice({
      now: NOW,
      offer: { ...offer, trial: intro },
      refusal: { code: "subscription-required", reason: "card-required" },
      refusedAt: NOW,
      status: undefined,
      statusReadAt: 0,
    });

    expect(notice && noticeCopy(notice, NOW)).toMatchObject({
      line: "Your first month is $1.",
      title: "Choose a plan to start.",
    });
  });
});

describe("subscriptionPhaseLine", () => {
  const subscribed = (phase: NonNullable<Status["subscription"]>["phase"]) =>
    ({
      canSubscribe: false,
      plan: "basic",
      subscription: { cancelAtPeriodEnd: false, phase, status: "active" },
      trial: { state: "ended" },
      windows: [],
    }) satisfies Status;

  it.each([
    {
      expected: "Free trial until October 12, then $10 a month",
      phase: {
        endsAt: new Date(2026, 9, 12, 9, 0).toISOString(),
        key: "trialing" as const,
      },
    },
    {
      expected: "Intro price until November 5, then $10 a month",
      phase: {
        endsAt: new Date(2026, 10, 5, 9, 0).toISOString(),
        key: "intro" as const,
      },
    },
    { expected: undefined, phase: undefined },
  ])("$phase.key", ({ expected, phase }) => {
    expect(subscriptionPhaseLine(subscribed(phase), "$10 a month", NOW)).toBe(
      expected,
    );
  });
});

describe("the free allowance", () => {
  it("has no plan for Instrument's models", () => {
    expect(hasNoPlan(onFree())).toBe(true);
    expect(hasNoPlan(noPlan)).toBe(true);
    expect(hasNoPlan(trialActive)).toBe(false);
    expect(accountNotice(onFree(), offer)).toEqual({
      kind: "plan-required",
      reason: "trial-available",
    });
  });

  // Before any refusal the note offers a plan, and says nothing of trials.
  it.each(["trial-capacity", "trial-paused"])(
    "leaves %s out of the note before any refusal",
    (reason) => {
      const status: Status = {
        ...onFree(),
        features: {
          decisions: { available: true },
          models: { available: false, code: "subscription-required", reason },
          search: { available: true },
        },
      };
      const notice = accountNotice(status, { ...offer, trial: null });
      expect(notice).toEqual({ kind: "plan-required" });
      expect(notice && noticeCopy(notice, NOW).title).toBe(
        "Instrument needs a plan.",
      );
    },
  );

  it.each([
    { expected: undefined, feature: "decisions", status: onFree() },
    {
      expected: { code: "usage-limit-exceeded", resetsAt: RESET },
      feature: "search",
      status: onFree(true),
    },
    {
      expected: { code: "subscription-required", reason: "trial-available" },
      feature: "models",
      status: onFree(),
    },
    // A platform that predates the block leaves every feature to try.
    { expected: undefined, feature: "decisions", status: noPlan },
    // Dictation is not reported yet.
    { expected: undefined, feature: "dictation", status: onFree(true) },
  ] as const)(
    "pauses $feature as $expected",
    ({ expected, feature, status }) => {
      expect(featurePause(status, feature, NOW)).toEqual(
        expected && expect.objectContaining(expected),
      );
    },
  );

  it("ends a pause once its reset passes, before the next read", () => {
    expect(
      featurePause(onFree(true), "search", new Date(RESET.getTime() + 1)),
    ).toBeUndefined();
  });

  it("says when free decisions and search come back, only on the free allowance", () => {
    expect(freeAllowancePause(onFree(true), NOW)).toEqual({ resetsAt: RESET });
    expect(freeAllowancePause(onFree(), NOW)).toBeUndefined();
    expect(
      freeAllowancePause({ ...onFree(true), plan: "basic" }, NOW),
    ).toBeUndefined();
  });

  it.each([
    { expected: true, name: "never trialed", offer, status: onFree() },
    {
      expected: false,
      name: "trial used",
      offer: {
        ...offer,
        trial: { available: false, cardRequired: false, days: 7 },
      },
      status: { ...onFree(), trial: { state: "ended" } } satisfies Status,
    },
    {
      expected: false,
      name: "card trial",
      offer: {
        ...offer,
        trial: { available: true, cardRequired: true, days: 7 },
      },
      status: onFree(),
    },
    {
      expected: false,
      name: "trials held back",
      offer: { ...offer, trial: null },
      status: onFree(),
    },
    { expected: false, name: "on the trial", offer, status: trialActive },
  ] satisfies {
    expected: boolean;
    name: string;
    offer: Offer;
    status: Status;
  }[])("starts a trial in the app when $name: $expected", (input) => {
    expect(canStartTrial(input.status, input.offer)).toBe(input.expected);
  });

  it("offers the trial on a trial-available refusal, then Continue once it runs", () => {
    const refusal = {
      code: "subscription-required",
      reason: "trial-available",
    };
    const refused = refusalNotice({
      now: NOW,
      offer,
      refusal,
      refusedAt: NOW,
      status: onFree(),
      statusReadAt: LATER,
    });
    expect(refused && noticeCopy(refused, NOW)).toEqual({
      action: { kind: "start-trial", label: "Start free trial" },
      secondary: { kind: "choose-plan", label: "Choose a plan" },
      title: "Start your free trial to use Instrument's models.",
    });
    expect(
      refusalNotice({
        now: NOW,
        offer,
        refusal,
        refusedAt: NOW,
        status: trialActive,
        statusReadAt: LATER,
      }),
    ).toEqual({ after: "trial-started", kind: "resumed", subscribed: false });
    expect(stopLineText(refusal)).toBe(
      "Stopped: start your free trial to keep going.",
    );
  });
});

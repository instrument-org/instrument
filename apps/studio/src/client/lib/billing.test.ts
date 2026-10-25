import { type RPCOutput } from "@/client/rpc/client";
import { describe, expect, it } from "vitest";

import {
  accountNotice,
  canStartTrial,
  describeWhen,
  featurePause,
  freeAllowancePause,
  hasNoPlan,
  isAccessRevoked,
  isNoteDismissed,
  NOTE_DISMISSED_FOR_MS,
  withNoteDismissed,
  isTrialHeldBack,
  type BillingNotice,
  nextStep,
  type NextStepInput,
  nextStepFor,
  refusalNotice,
  stopLineText,
  trialOption,
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
  trial: { available: true, days: 7 },
};

// Local time throughout, so the words do not depend on the machine's zone.
const NOW = new Date(2026, 9, 5, 12, 0);
const LATER = NOW.getTime() + 60_000;

/** What a chat on Instrument's models says for `notice`, with another model to change to. */
const copy = (
  notice: BillingNotice,
  status?: Status,
  theOffer: Offer | undefined = offer,
) =>
  nextStepFor(
    {
      blocked: "models",
      notice,
      offer: theOffer,
      otherModelCan: true,
      status,
    },
    NOW,
  );

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
    expect(resumed && copy(resumed, onPlan("basic")).title).toBe(title);
  });

  // The trial isn't over, so the way forward is a plan rather than waiting.
  it.each(["trial-capacity", "trial-paused"])(
    "offers the plans when a trial can't start (%s)",
    (reason) => {
      const held = notice({ code: "subscription-required", reason }, noPlan);
      expect(held && copy(held)).toMatchInlineSnapshot(`
        {
          "action": {
            "kind": "choose-plan",
            "label": "Choose a plan",
          },
          "changeModel": true,
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
    expect(limit && copy(limit, onPlan("basic", {}, [100, 40, 20])))
      .toMatchInlineSnapshot(`
        {
          "action": {
            "kind": "upgrade",
            "label": "Upgrade",
          },
          "changeModel": true,
          "line": "It resets at 3:40 PM.",
          "title": "You've reached your plan's limit for now.",
        }
      `);
  });

  it("offers to contact us on the biggest plan", () => {
    const limit = notice(
      {
        code: "usage-limit-exceeded",
        resetsAt: new Date(2026, 9, 12, 9, 12).toISOString(),
        window: "week",
      },
      onPlan("pro", {}, [30, 100, 20]),
    );
    expect(limit && copy(limit, onPlan("pro", {}, [30, 100, 20])))
      .toMatchInlineSnapshot(`
        {
          "action": {
            "kind": "send-feedback",
            "label": "Contact us",
          },
          "changeModel": true,
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
  expect(copy({ kind: "access-revoked" }, noPlan)).toMatchInlineSnapshot(`
    {
      "action": {
        "kind": "send-feedback",
        "label": "Contact support",
      },
      "changeModel": true,
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

describe("upgradePlan", () => {
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
      trial: { available: true, days: 7 },
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
      expect(
        notice && copy(notice, status, { ...offer, trial: null }).title,
      ).toBe("Choose a plan to use Instrument's models.");
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
      freeAllowancePause(
        {
          ...onFree(),
          features: {
            decisions: { available: true },
            models: { available: false, code: "subscription-required" },
            search: { available: true },
            images: {
              available: false,
              code: "usage-limit-exceeded",
              resetsAt: RESET.toISOString(),
            },
          },
        },
        NOW,
      ),
    ).toEqual({ resetsAt: RESET });
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
        trial: { available: false, days: 7 },
      },
      status: { ...onFree(), trial: { state: "ended" } } satisfies Status,
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
    expect(refused && copy(refused, onFree())).toEqual({
      action: { kind: "start-trial", label: "Start free trial" },
      changeModel: true,
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

describe("trialOption", () => {
  it.each([
    { expected: "in-app", name: "a no-card trial", offer, status: onFree() },
    {
      expected: "held-back",
      name: "trials held back",
      offer: { ...offer, trial: null },
      status: onFree(),
    },
    {
      expected: "none",
      name: "a trial taken",
      offer,
      status: { ...onFree(), trial: { state: "ended" } } satisfies Status,
    },
    { expected: "none", name: "a trial running", offer, status: trialActive },
    { expected: "none", name: "a plan", offer, status: onPlan("basic") },
    {
      expected: "in-app",
      name: "a trial-available refusal before billing is read",
      offer: undefined,
      reason: "trial-available",
      status: undefined,
    },
    {
      expected: "held-back",
      name: "a trial-paused refusal before billing is read",
      offer: undefined,
      reason: "trial-paused",
      status: undefined,
    },
    {
      expected: "none",
      name: "nothing read and no reason",
      offer,
      status: undefined,
    },
  ] satisfies {
    expected: string;
    name: string;
    offer: Offer | undefined;
    reason?: string;
    status: Status | undefined;
  }[])("$name: $expected", (row) => {
    expect(trialOption(row.status, row.offer, row.reason).kind).toBe(
      row.expected,
    );
  });
});

describe("nextStep", () => {
  const resetsAt = new Date(2026, 9, 6, 9, 12);
  const pro = offer.plans.find((plan) => plan.key === "pro");

  /** Every input that decides the step, in a row, and what each gets. */
  const rows: [
    string,
    Partial<NextStepInput> & Pick<NextStepInput, "notice">,
  ][] = [
    ["signed out, an image", { notice: { kind: "sign-in" } }],
    [
      "signed out, dictation",
      { blocked: "dictation", notice: { kind: "sign-in" } },
    ],
    [
      "free, spent, no-card trial",
      {
        notice: { kind: "plan-limit", resetsAt },
        plan: "free",
        trial: { kind: "in-app" },
      },
    ],
    [
      "free, spent, trials held back",
      {
        notice: { kind: "plan-limit", resetsAt },
        plan: "free",
        trial: { kind: "held-back" },
      },
    ],
    [
      "free, spent, trial taken",
      { notice: { kind: "plan-limit" }, plan: "free" },
    ],
    [
      "on the trial, spent",
      { notice: { kind: "plan-limit", resetsAt }, plan: "trial" },
    ],
    [
      "on a plan, spent, bigger plan",
      {
        notice: {
          kind: "plan-limit",
          resetsAt,
          ...(pro && { upgradeTo: pro }),
        },
        plan: "basic",
      },
    ],
    [
      "on the biggest plan, spent",
      { notice: { kind: "plan-limit", resetsAt }, plan: "pro" },
    ],
    [
      "no plan, no-card trial",
      {
        notice: { kind: "plan-required", reason: "trial-available" },
        plan: "free",
        trial: { kind: "in-app" },
      },
    ],
    [
      "no plan, trials paused, refused for it",
      {
        notice: { kind: "plan-required", reason: "trial-paused" },
        plan: "free",
        trial: { kind: "held-back" },
      },
    ],
    [
      "no plan, trials held back, not refused for it",
      {
        notice: { kind: "plan-required" },
        plan: "free",
        trial: { kind: "held-back" },
      },
    ],
    [
      "no plan, trial taken",
      { notice: { kind: "plan-required" }, plan: "none" },
    ],
    [
      "no plan, a search",
      { blocked: "search", notice: { kind: "plan-required" }, plan: "free" },
    ],
    ["trial ended", { notice: { kind: "trial-ended" }, plan: "trial" }],
    ["card failed", { notice: { kind: "payment-failed" }, plan: "none" }],
    ["access revoked", { notice: { kind: "access-revoked" }, plan: "none" }],
    ["usage back", { notice: { kind: "resumed", subscribed: false } }],
    ["subscribed since", { notice: { kind: "resumed", subscribed: true } }],
    [
      "trial started since",
      {
        notice: { after: "trial-started", kind: "resumed", subscribed: false },
      },
    ],
    [
      "card fixed since",
      {
        notice: { after: "payment-failed", kind: "resumed", subscribed: true },
      },
    ],
    [
      "access back since",
      {
        notice: { after: "access-revoked", kind: "resumed", subscribed: true },
      },
    ],
    [
      "an image spent, before the account is read",
      { notice: { kind: "plan-limit", resetsAt } },
    ],
    [
      "a search, free, spent",
      {
        blocked: "search",
        notice: { kind: "plan-limit", resetsAt },
        plan: "free",
        trial: { kind: "in-app" },
      },
    ],
    [
      "dictation, free, spent",
      {
        blocked: "dictation",
        notice: { kind: "plan-limit", resetsAt },
        plan: "free",
        trial: { kind: "in-app" },
      },
    ],
    [
      "a turn, free, spent",
      {
        blocked: "models",
        notice: { kind: "plan-limit", resetsAt },
        plan: "free",
      },
    ],
    [
      "a turn, another model to use",
      {
        blocked: "models",
        notice: { kind: "plan-limit", resetsAt },
        otherModelCan: true,
        plan: "basic",
      },
    ],
    [
      "a turn, only Instrument's models",
      {
        blocked: "models",
        notice: { kind: "plan-required", reason: "trial-available" },
        plan: "free",
        trial: { kind: "in-app" },
      },
    ],
    [
      "a turn back, another model to use",
      {
        blocked: "models",
        notice: { kind: "resumed", subscribed: false },
        otherModelCan: true,
      },
    ],
  ];

  it("decides every state", () => {
    const table = rows.map(([name, input]) => {
      const step = nextStep(
        {
          blocked: "images",
          otherModelCan: false,
          plan: undefined,
          trial: { kind: "none" },
          ...input,
        },
        NOW,
      );
      const buttons = [
        step.action && `[${step.action.label}→${step.action.kind}]`,
        step.changeModel && "[Change model]",
      ].filter(Boolean);
      return `${name}: ${step.title}${step.line ? ` ${step.line}` : ""} ${buttons.join(" ")}`.trim();
    });
    expect(table).toMatchInlineSnapshot(`
      [
        "signed out, an image: Make images with a free Instrument account. It works in any chat, whatever AI you use. [Continue with Google→sign-in]",
        "signed out, dictation: Sign in to use dictation. [Continue with Google→sign-in]",
        "free, spent, no-card trial: Images are paused until tomorrow at 9:12 AM. Your free Instrument usage ran out. [Start free trial→start-trial]",
        "free, spent, trials held back: Images are paused until tomorrow at 9:12 AM. Your free Instrument usage ran out. [Choose a plan→choose-plan]",
        "free, spent, trial taken: Images are paused for now. Your free Instrument usage ran out. [Choose a plan→choose-plan]",
        "on the trial, spent: Images are paused until tomorrow at 9:12 AM. Your free trial's usage ran out. [Choose a plan→choose-plan]",
        "on a plan, spent, bigger plan: Images are paused until tomorrow at 9:12 AM. Your plan's usage ran out. [Upgrade→upgrade]",
        "on the biggest plan, spent: Images are paused until tomorrow at 9:12 AM. Your plan's usage ran out. [Contact us→send-feedback]",
        "no plan, no-card trial: Start your free trial to make images. [Start free trial→start-trial]",
        "no plan, trials paused, refused for it: Free trials aren't available right now. [Choose a plan→choose-plan]",
        "no plan, trials held back, not refused for it: Choose a plan to make images. [Choose a plan→choose-plan]",
        "no plan, trial taken: Choose a plan to make images. [Choose a plan→choose-plan]",
        "no plan, a search: Choose a plan to use Instrument's web search. [Choose a plan→choose-plan]",
        "trial ended: Your free trial has ended. [Choose a plan→choose-plan]",
        "card failed: Your payment didn't go through. Update your card to keep going. [Update card→update-card]",
        "access revoked: Instrument isn't available on this account. Get in touch and we'll sort it out. [Contact support→send-feedback]",
        "usage back: Your usage limit has reset. [Continue→continue]",
        "subscribed since: You're subscribed. [Continue→continue]",
        "trial started since: Your free trial has started. [Continue→continue]",
        "card fixed since: Your payment went through. [Continue→continue]",
        "access back since: Instrument is available again. [Continue→continue]",
        "an image spent, before the account is read: Images are paused until tomorrow at 9:12 AM.",
        "a search, free, spent: Web search through Instrument is paused until tomorrow at 9:12 AM. Your free Instrument usage ran out. [Start free trial→start-trial]",
        "dictation, free, spent: You've reached your free account's limit for now. It resets tomorrow at 9:12 AM. [Start free trial→start-trial]",
        "a turn, free, spent: You've reached your free account's limit for now. It resets tomorrow at 9:12 AM. [Choose a plan→choose-plan]",
        "a turn, another model to use: You've reached your plan's limit for now. It resets tomorrow at 9:12 AM. [Contact us→send-feedback] [Change model]",
        "a turn, only Instrument's models: Start your free trial to use Instrument's models. [Start free trial→start-trial]",
        "a turn back, another model to use: Your usage limit has reset. [Continue→continue]",
      ]
    `);
  });
});

describe("isNoteDismissed", () => {
  const now = NOW.getTime();
  const day = 86_400_000;
  it.each([
    {
      blocksOwnSend: false,
      dismissedAt: undefined,
      expected: false,
      name: "never dismissed",
    },
    {
      blocksOwnSend: false,
      dismissedAt: now - day,
      expected: true,
      name: "dismissed yesterday",
    },
    {
      blocksOwnSend: false,
      dismissedAt: now - 6 * day,
      expected: true,
      name: "dismissed six days ago",
    },
    {
      blocksOwnSend: false,
      dismissedAt: now - NOTE_DISMISSED_FOR_MS,
      expected: false,
      name: "the week out",
    },
    {
      blocksOwnSend: false,
      dismissedAt: now - 30 * day,
      expected: false,
      name: "dismissed a month ago",
    },
    {
      blocksOwnSend: true,
      dismissedAt: now - day,
      expected: false,
      name: "a block of the person's own send",
    },
    {
      blocksOwnSend: false,
      dismissedAt: now + day,
      expected: false,
      name: "a clock that moved back",
    },
  ])("$name: $expected", ({ expected, ...input }) => {
    expect(isNoteDismissed({ ...input, now })).toBe(expected);
  });

  it("keeps a dismissal per reason and drops the ones whose week is out", () => {
    expect(
      withNoteDismissed(
        { "images:plan-limit": now - 8 * day, "search:paused": now - day },
        "images:sign-in",
        now,
      ),
    ).toEqual({ "images:sign-in": now, "search:paused": now - day });
  });
});

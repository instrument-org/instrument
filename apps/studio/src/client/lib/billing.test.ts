import { type RPCOutput } from "@/client/rpc/client";
import { describe, expect, it } from "vitest";

import {
  allowanceLabel,
  describeWhen,
  noticeCopy,
  planCardAction,
  refusalNotice,
  stopLineText,
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
      expected: "resumed",
      name: "a plan bought since",
      reason: "trial-ended",
      status: onPlan("basic"),
    },
  ])("subscription-required, $name: $expected", ({ expected, reason, status }) => {
    expect(notice({ code: "subscription-required", reason }, status)?.kind).toBe(
      expected,
    );
  });

  it("keeps the trial ended when its last request would have gone over", () => {
    expect(
      notice({ code: "subscription-required", reason: "trial-ended" }, {
        ...trialActive,
        trial: { ...trialActive.trial, percentUsed: 85 },
      })?.kind,
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
        "title": "You've reached your plan's limit for now",
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
        "title": "You've reached your plan's limit for now",
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

describe("stopLineText", () => {
  it.each([
    {
      line: "Stopped: your free trial has ended.",
      refusal: { code: "subscription-required", reason: "trial-ended" },
    },
    {
      line: "Stopped: Instrument's AI needs a plan.",
      refusal: { code: "subscription-required", reason: "no-plan" },
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
  ])("$name: $expected", ({ expected, plan, status, trial }) => {
    expect(plan && planCardAction(plan, status, { trial })).toBe(expected);
  });

  it("names allowance against the first plan", () => {
    expect(offer.plans.map((plan) => allowanceLabel(plan))).toEqual([
      "Standard",
      "4× Standard",
    ]);
  });

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
    expect(warning && usageWarningText(warning, NOW)).toMatchInlineSnapshot(`"82% of your free trial is used. It ends October 11 or when it runs out."`);
  });

  it("warns about the fullest window at 80% or more", () => {
    const warning = usageWarning(onPlan("basic", {}, [81, 93, 10]));
    expect(warning).toMatchObject({ kind: "window", window: "week" });
    expect(warning && usageWarningText(warning, NOW)).toMatchInlineSnapshot(`"You've used 93% of your plan for this week. It resets at 3:41 PM."`);
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

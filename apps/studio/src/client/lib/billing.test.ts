import { type RPCOutput } from "@/client/rpc/client";
import { describe, expect, it } from "vitest";

import {
  accountNotice,
  autoIncludedLine,
  type BillingNotice,
  describeWhen,
  featurePause,
  freeAllowancePause,
  isNoteDismissed,
  nextStep,
  type NextStepInput,
  nextStepFor,
  NOTE_DISMISSED_FOR_MS,
  offersTrial,
  refusalNotice,
  stopLineText,
  usageWarning,
  usageWarningText,
  withNoteDismissed,
} from "./billing";

type Status = RPCOutput["billing"]["status"];

// Local time throughout, so the words do not depend on the machine's zone.
const NOW = new Date(2026, 9, 5, 12, 0);
const LATER = NOW.getTime() + 60_000;
const RESET = new Date(2026, 10, 4, 9, 0);

const START_TRIAL = {
  action: "start-trial",
  label: "Start free trial",
  page: "/welcome",
};
const CHOOSE_PLAN = {
  action: "choose-plan",
  label: "Choose a plan",
  page: "/welcome",
};
const UPGRADE = {
  action: "upgrade",
  label: "Upgrade",
  page: "/welcome",
  plan: "pro",
};
const CONTACT = { action: "contact", label: "Contact us" };
const UPDATE_CARD = {
  action: "update-card",
  label: "Update card",
  page: "/account",
};

const RUNS = { available: true } as const;
const FEATURES_RUN = {
  decisions: RUNS,
  dictation: RUNS,
  images: RUNS,
  models: RUNS,
  search: RUNS,
};

const WINDOW_WORDS = {
  "5h": { label: "Current 5 hours", period: "the current 5 hours" },
  month: { label: "This month", period: "this month" },
  week: { label: "This week", period: "this week" },
} as const;

/** What a chat on Instrument's models says for `notice`, with another model to change to. */
const copy = (notice: BillingNotice, status?: Status) =>
  nextStepFor({ blocked: "models", notice, otherModelCan: true, status }, NOW);

const trialActive: Status = {
  account: { state: "active", tier: "trial" },
  canSubscribe: true,
  features: FEATURES_RUN,
  plan: "trial",
  trial: {
    endsAt: new Date(2026, 9, 11, 9, 0).toISOString(),
    percentUsed: 45,
    state: "active",
  },
  windows: [],
};

/** The free allowance, with its features spent until `RESET` when `paused`. */
const onFree = (
  paused = false,
  models: { next: typeof START_TRIAL; outcome: string } = {
    next: START_TRIAL,
    outcome: "plan-required",
  },
): Status => {
  const spent = {
    available: false,
    code: "usage-limit-exceeded",
    next: START_TRIAL,
    outcome: "limit-reached",
    resetsAt: RESET.toISOString(),
  };
  return {
    account: { next: models.next, state: models.outcome, tier: "free" },
    canSubscribe: true,
    features: {
      decisions: paused ? spent : RUNS,
      dictation: RUNS,
      images: paused ? spent : RUNS,
      models: {
        available: false,
        code: "subscription-required",
        ...models,
      },
      search: paused ? spent : RUNS,
    },
    plan: "free",
    trial: { state: "available" },
    windows: [
      {
        key: "free",
        label: "Free usage",
        percentUsed: paused ? 100 : 5,
        period: "your free usage",
      },
    ],
  };
};

/** A paid plan whose windows stand at `percents`; a full one stops its models. */
const onPlan = (
  percents: number[] = [20, 10, 5],
  upgradeTo?: string,
): Status => {
  const full = percents.some((percent) => percent >= 100);
  const resetsAt = new Date(2026, 9, 5, 15, 40).toISOString();
  return {
    account: {
      ...(full && {
        next: upgradeTo ? UPGRADE : CONTACT,
        resetsAt,
      }),
      planName: "Basic",
      state: full ? "limit-reached" : "active",
      tier: "paid",
      ...(upgradeTo && { upgradeTo }),
    },
    canSubscribe: false,
    features: {
      ...FEATURES_RUN,
      models: full
        ? {
            available: false,
            code: "usage-limit-exceeded",
            next: upgradeTo ? UPGRADE : CONTACT,
            outcome: "limit-reached",
            resetsAt,
          }
        : RUNS,
    },
    plan: "basic",
    subscription: {
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date(2026, 10, 5).toISOString(),
      plan: "basic",
      status: "active",
    },
    trial: { state: "ended" },
    windows: (["5h", "week", "month"] as const).map((key, index) => ({
      key,
      ...WINDOW_WORDS[key],
      percentUsed: percents[index] ?? 0,
      resetsAt: new Date(2026, 9, 5, 15, 40 + index).toISOString(),
    })),
  };
};

/** An account the platform refuses outright with `outcome`. */
const refused = (outcome: string, next: typeof CONTACT): Status => ({
  account: {
    next,
    state: outcome,
    tier: outcome === "access-revoked" ? "none" : "free",
  },
  canSubscribe: outcome !== "access-revoked",
  features: {
    ...FEATURES_RUN,
    models: { available: false, code: "subscription-required", next, outcome },
  },
  plan: "none",
  trial: { state: "ended" },
  windows: [],
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
      blocked: "models",
      now: NOW,
      refusal,
      refusedAt: NOW,
      status,
      statusReadAt,
    });

  it("says what the refusal said while nothing newer is known", () => {
    expect(
      notice(
        {
          code: "subscription-required",
          next: CHOOSE_PLAN,
          outcome: "trial-ended",
          reason: "trial-ended",
        },
        undefined,
      ),
    ).toEqual({
      kind: "blocked",
      next: CHOOSE_PLAN,
      outcome: "trial-ended",
      refused: true,
    });
  });

  it("takes the platform's newer word over the refusal's", () => {
    expect(
      notice(
        {
          code: "subscription-required",
          next: CHOOSE_PLAN,
          outcome: "plan-required",
        },
        refused("payment-failed", UPDATE_CARD),
      ),
    ).toMatchObject({ next: UPDATE_CARD, outcome: "payment-failed" });
  });

  it.each([
    { after: "subscribed", outcome: "trial-ended", status: onPlan() },
    { after: "payment-failed", outcome: "payment-failed", status: onPlan() },
    { after: "access-revoked", outcome: "access-revoked", status: onPlan() },
    { after: "trial-started", outcome: "plan-required", status: trialActive },
  ])(
    "calls $outcome lifted ($after) once the platform says models run",
    ({ after, outcome, status }) => {
      expect(
        notice({ code: "subscription-required", outcome }, status),
      ).toEqual({ after, kind: "resumed" });
    },
  );

  it("says what changed in the words a person reads", () => {
    const resumed = notice(
      { code: "subscription-required", outcome: "payment-failed" },
      onPlan(),
    );
    expect(resumed && copy(resumed, onPlan()).title).toBe(
      "Your payment went through.",
    );
  });

  it("keeps a trial ended while the status still calls it running", () => {
    expect(
      notice(
        {
          code: "subscription-required",
          next: CHOOSE_PLAN,
          outcome: "trial-ended",
        },
        trialActive,
      )?.kind,
    ).toBe("blocked");
  });

  it("does not take a status read before the refusal as the account now", () => {
    expect(
      notice(
        {
          code: "subscription-required",
          next: CHOOSE_PLAN,
          outcome: "plan-required",
        },
        onPlan(),
        NOW.getTime() - 1,
      )?.kind,
    ).toBe("blocked");
  });

  it("offers the step the platform names past a limit", () => {
    const limit = notice(
      {
        code: "usage-limit-exceeded",
        next: UPGRADE,
        outcome: "limit-reached",
        resetsAt: new Date(2026, 9, 5, 15, 40).toISOString(),
      },
      undefined,
    );
    expect(limit && copy(limit, onPlan([100, 40, 20], "pro")))
      .toMatchInlineSnapshot(`
        {
          "action": {
            "kind": "upgrade",
            "label": "Upgrade",
            "plan": "pro",
          },
          "changeModel": true,
          "line": "It resets at 3:40 PM.",
          "title": "You've reached your plan's limit for now.",
        }
      `);
  });

  it("turns into Continue once the window has reset", () => {
    expect(
      notice(
        {
          code: "usage-limit-exceeded",
          outcome: "limit-reached",
          resetsAt: new Date(2026, 9, 5, 11, 0).toISOString(),
        },
        undefined,
      ),
    ).toEqual({ after: "limit-reset", kind: "resumed" });
  });

  it("has nothing to say about a refusal that named no outcome", () => {
    expect(notice({ code: "concurrency-limit" }, undefined)).toBeUndefined();
    expect(
      notice(
        { code: "subscription-required", reason: "trial-ended" },
        undefined,
      ),
    ).toBeUndefined();
  });
});

describe("accountNotice", () => {
  it("says what the platform says the next turn would meet", () => {
    const rows: [string, Status][] = [
      ["a trial under way", trialActive],
      ["a plan with room", onPlan()],
      ["the free allowance", onFree()],
      ["a spent window", onPlan([100, 40, 10], "pro")],
      ["a failed payment", refused("payment-failed", UPDATE_CARD)],
      ["revoked access", refused("access-revoked", CONTACT)],
    ];
    expect(
      rows.map(([name, status]) => {
        const found = accountNotice(status);
        const step = found && copy(found, status);
        return step
          ? `${name}: ${step.title}${step.line ? ` ${step.line}` : ""} [${step.action?.label ?? ""}]`
          : `${name}: nothing`;
      }),
    ).toMatchInlineSnapshot(`
      [
        "a trial under way: nothing",
        "a plan with room: nothing",
        "the free allowance: Start your free trial to use Instrument's models. [Start free trial]",
        "a spent window: You've reached your plan's limit for now. It resets at 3:40 PM. [Upgrade]",
        "a failed payment: Your payment didn't go through. Update your card to keep going. [Update card]",
        "revoked access: Instrument isn't available on this account. Get in touch and we'll sort it out. [Contact support]",
      ]
    `);
  });
});

describe("nextStep", () => {
  const resetsAt = new Date(2026, 9, 6, 9, 12);
  const blocked = (
    outcome: string,
    next?: Partial<typeof UPGRADE> & { action: string; label: string },
    extra: { refused?: true; resetsAt?: Date } = {},
  ): BillingNotice => ({
    kind: "blocked",
    ...(next && { next }),
    outcome,
    ...extra,
  });

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
      "free, spent, trial to start",
      {
        notice: blocked("limit-reached", START_TRIAL, { resetsAt }),
        tier: "free",
      },
    ],
    [
      "free, spent, a plan",
      { notice: blocked("limit-reached", CHOOSE_PLAN), tier: "free" },
    ],
    [
      "on the trial, spent",
      {
        notice: blocked("limit-reached", CHOOSE_PLAN, { resetsAt }),
        tier: "trial",
      },
    ],
    [
      "on a plan, spent, bigger plan",
      { notice: blocked("limit-reached", UPGRADE, { resetsAt }), tier: "paid" },
    ],
    [
      "on the biggest plan, spent",
      { notice: blocked("limit-reached", CONTACT, { resetsAt }), tier: "paid" },
    ],
    [
      "no plan, trial to start",
      { notice: blocked("plan-required", START_TRIAL), tier: "free" },
    ],
    [
      "no plan, trials paused, refused for it",
      {
        notice: blocked("trials-unavailable", CHOOSE_PLAN, { refused: true }),
        tier: "free",
      },
    ],
    [
      "no plan, trials paused, not refused for it",
      { notice: blocked("trials-unavailable", CHOOSE_PLAN), tier: "free" },
    ],
    [
      "no plan, a search",
      {
        blocked: "search",
        notice: blocked("plan-required", CHOOSE_PLAN),
        tier: "free",
      },
    ],
    [
      "trial ended",
      { notice: blocked("trial-ended", CHOOSE_PLAN), tier: "free" },
    ],
    [
      "card failed",
      { notice: blocked("payment-failed", UPDATE_CARD), tier: "free" },
    ],
    [
      "access revoked",
      { notice: blocked("access-revoked", CONTACT), tier: "none" },
    ],
    [
      "an outcome this build doesn't know",
      {
        notice: blocked("seat-unassigned", {
          action: "ask-admin",
          label: "Ask your admin",
          page: "/team",
        }),
        tier: "paid",
      },
    ],
    [
      "an action with no page",
      {
        notice: blocked("plan-required", { action: "wait", label: "Wait" }),
        tier: "free",
      },
    ],
    ["usage back", { notice: { after: "limit-reset", kind: "resumed" } }],
    ["subscribed since", { notice: { after: "subscribed", kind: "resumed" } }],
    [
      "trial started since",
      { notice: { after: "trial-started", kind: "resumed" } },
    ],
    [
      "card fixed since",
      { notice: { after: "payment-failed", kind: "resumed" } },
    ],
    [
      "access back since",
      { notice: { after: "access-revoked", kind: "resumed" } },
    ],
    [
      "an image spent, before the account is read",
      { notice: blocked("limit-reached", START_TRIAL, { resetsAt }) },
    ],
    [
      "a search, free, spent",
      {
        blocked: "search",
        notice: blocked("limit-reached", START_TRIAL, { resetsAt }),
        tier: "free",
      },
    ],
    [
      "dictation, free, spent",
      {
        blocked: "dictation",
        notice: blocked("limit-reached", START_TRIAL, { resetsAt }),
        tier: "free",
      },
    ],
    [
      "a turn, another model to use",
      {
        blocked: "models",
        notice: blocked("limit-reached", CONTACT, { resetsAt }),
        otherModelCan: true,
        tier: "paid",
      },
    ],
    [
      "a turn back, another model to use",
      {
        blocked: "models",
        notice: { after: "limit-reset", kind: "resumed" },
        otherModelCan: true,
      },
    ],
  ];

  it("decides every state", () => {
    const table = rows.map(([name, input]) => {
      const step = nextStep(
        { blocked: "images", otherModelCan: false, tier: undefined, ...input },
        NOW,
      );
      const action = step.action;
      const buttons = [
        action &&
          `[${action.label}→${action.kind}${action.plan ? ` ${action.plan}` : ""}${action.page ? ` ${action.page}` : ""}]`,
        step.changeModel && "[Change model]",
      ].filter(Boolean);
      return `${name}: ${step.title}${step.line ? ` ${step.line}` : ""} ${buttons.join(" ")}`.trim();
    });
    expect(table).toMatchInlineSnapshot(`
      [
        "signed out, an image: Make images with a free Instrument account. It works in any chat, whatever AI you use. [Continue with Google→sign-in]",
        "signed out, dictation: Sign in to use dictation. [Continue with Google→sign-in]",
        "free, spent, trial to start: Images are paused until tomorrow at 9:12 AM. Your free Instrument usage ran out. [Start free trial→start-trial]",
        "free, spent, a plan: Images are paused for now. Your free Instrument usage ran out. [Choose a plan→choose-plan]",
        "on the trial, spent: Images are paused until tomorrow at 9:12 AM. Your free trial's usage ran out. [Choose a plan→choose-plan]",
        "on a plan, spent, bigger plan: Images are paused until tomorrow at 9:12 AM. Your plan's usage ran out. [Upgrade→upgrade pro]",
        "on the biggest plan, spent: Images are paused until tomorrow at 9:12 AM. Your plan's usage ran out. [Contact us→contact]",
        "no plan, trial to start: Start your free trial to make images. [Start free trial→start-trial]",
        "no plan, trials paused, refused for it: Free trials aren't available right now. [Choose a plan→choose-plan]",
        "no plan, trials paused, not refused for it: Choose a plan to make images. [Choose a plan→choose-plan]",
        "no plan, a search: Choose a plan to use Instrument's web search. [Choose a plan→choose-plan]",
        "trial ended: Your free trial has ended. [Choose a plan→choose-plan]",
        "card failed: Your payment didn't go through. Update your card to keep going. [Update card→update-card]",
        "access revoked: Instrument isn't available on this account. Get in touch and we'll sort it out. [Contact support→contact]",
        "an outcome this build doesn't know: You can't make images right now. [Ask your admin→website /team]",
        "an action with no page: Choose a plan to make images.",
        "usage back: Your usage limit has reset. [Continue→continue]",
        "subscribed since: You're subscribed. [Continue→continue]",
        "trial started since: Your free trial has started. [Continue→continue]",
        "card fixed since: Your payment went through. [Continue→continue]",
        "access back since: Instrument is available again. [Continue→continue]",
        "an image spent, before the account is read: Images are paused until tomorrow at 9:12 AM. [Start free trial→start-trial]",
        "a search, free, spent: Web search through Instrument is paused until tomorrow at 9:12 AM. Your free Instrument usage ran out. [Start free trial→start-trial]",
        "dictation, free, spent: You've reached your free account's limit for now. It resets tomorrow at 9:12 AM. [Start free trial→start-trial]",
        "a turn, another model to use: You've reached your plan's limit for now. It resets tomorrow at 9:12 AM. [Contact us→contact] [Change model]",
        "a turn back, another model to use: Your usage limit has reset. [Continue→continue]",
      ]
    `);
  });
});

describe("stopLineText", () => {
  it("ends a refused turn on one line, from the refusal alone", () => {
    const refusals = [
      {
        code: "subscription-required",
        next: CHOOSE_PLAN,
        outcome: "trial-ended",
      },
      {
        code: "subscription-required",
        next: CHOOSE_PLAN,
        outcome: "plan-required",
      },
      {
        code: "subscription-required",
        next: START_TRIAL,
        outcome: "plan-required",
      },
      {
        code: "subscription-required",
        next: CHOOSE_PLAN,
        outcome: "trials-unavailable",
      },
      {
        code: "subscription-required",
        next: UPDATE_CARD,
        outcome: "payment-failed",
      },
      {
        code: "subscription-required",
        next: CONTACT,
        outcome: "access-revoked",
      },
      { code: "usage-limit-exceeded", next: UPGRADE, outcome: "limit-reached" },
      // Recorded before the platform named outcomes, or one this build doesn't know.
      { code: "subscription-required", reason: "trial-ended" },
      { code: "subscription-required", reason: "trial-available" },
      { code: "subscription-required", reason: "trial-capacity" },
      { code: "subscription-required", reason: "payment-failed" },
      { code: "usage-limit-exceeded", outcome: "seat-spent" },
      { code: "concurrency-limit" },
      { code: "meter-unavailable" },
    ];
    expect(
      refusals.map(
        (refusal) =>
          `${refusal.code} ${refusal.outcome ?? refusal.reason ?? "-"} ${refusal.next?.action ?? "-"}: ${stopLineText(refusal) ?? "no line"}`,
      ),
    ).toMatchInlineSnapshot(`
      [
        "subscription-required trial-ended choose-plan: Stopped: your free trial has ended.",
        "subscription-required plan-required choose-plan: Stopped: Instrument needs a plan.",
        "subscription-required plan-required start-trial: Stopped: start your free trial to keep going.",
        "subscription-required trials-unavailable choose-plan: Stopped: free trials aren't available right now.",
        "subscription-required payment-failed update-card: Stopped: your payment didn't go through.",
        "subscription-required access-revoked contact: Stopped: Instrument isn't available on this account.",
        "usage-limit-exceeded limit-reached upgrade: Stopped: you've reached your plan's limit for now.",
        "subscription-required trial-ended -: Stopped: your free trial has ended.",
        "subscription-required trial-available -: Stopped: start your free trial to keep going.",
        "subscription-required trial-capacity -: Stopped: free trials aren't available right now.",
        "subscription-required payment-failed -: Stopped: your payment didn't go through.",
        "usage-limit-exceeded seat-spent -: Stopped: you've reached your plan's limit for now.",
        "concurrency-limit - -: Stopped: too many of your tasks were running at once.",
        "meter-unavailable - -: no line",
      ]
    `);
  });
});

describe("usageWarning", () => {
  it("says nothing under 80%", () => {
    expect(usageWarning(trialActive)).toBeUndefined();
    expect(usageWarning(onPlan([79, 50, 10]))).toBeUndefined();
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

  it("warns about the fullest window at 80% or more, in the platform's words for it", () => {
    const warning = usageWarning(onPlan([81, 93, 10]));
    expect(warning).toMatchObject({ kind: "window", period: "this week" });
    expect(warning && usageWarningText(warning, NOW)).toMatchInlineSnapshot(
      `"You've used 93% of your plan for this week. It resets at 3:41 PM."`,
    );
  });

  it("leaves a full window to the refusal notice", () => {
    expect(usageWarning(onPlan([100, 50, 10]))).toBeUndefined();
  });

  it("keys a warning by its period, so dismissing it lasts until the next", () => {
    const first = usageWarning(onPlan([85, 50, 10]));
    const second = usageWarning(onPlan([90, 50, 10]));
    expect(first?.key).toBe(second?.key);
  });
});

describe("the free allowance", () => {
  it.each([
    { expected: undefined, feature: "decisions", status: onFree() },
    {
      expected: {
        code: "usage-limit-exceeded",
        next: START_TRIAL,
        outcome: "limit-reached",
        resetsAt: RESET,
      },
      feature: "search",
      status: onFree(true),
    },
    {
      expected: { code: "subscription-required", outcome: "plan-required" },
      feature: "models",
      status: onFree(),
    },
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

  it("names what is spent and when it comes back, only on the free allowance", () => {
    expect(freeAllowancePause(onFree(true), NOW)).toEqual({
      features: ["search", "images", "decisions"],
      resetsAt: RESET,
    });
    expect(freeAllowancePause(onFree(), NOW)).toBeUndefined();
    expect(
      freeAllowancePause(
        { ...onFree(true), account: { state: "active", tier: "paid" } },
        NOW,
      ),
    ).toBeUndefined();
  });

  it("offers the trial only while the platform's way in is the trial", () => {
    expect(offersTrial(onFree())).toBe(true);
    expect(
      offersTrial(
        onFree(false, { next: CHOOSE_PLAN, outcome: "trials-unavailable" }),
      ),
    ).toBe(false);
    expect(offersTrial(trialActive)).toBe(false);
  });
});

describe("autoIncludedLine", () => {
  it("names what includes Auto only while it runs", () => {
    expect([
      autoIncludedLine(trialActive),
      autoIncludedLine(onPlan()),
      autoIncludedLine(onFree()),
      autoIncludedLine(onPlan([100, 0, 0])),
    ]).toMatchInlineSnapshot(`
      [
        "Included with your free trial",
        "Included with your plan",
        undefined,
        undefined,
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

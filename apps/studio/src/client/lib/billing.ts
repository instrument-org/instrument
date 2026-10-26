import { displayLocale } from "@/client/lib/display-locale";
import { type RPCOutput } from "@/client/rpc/client";
import { APP_NAME, type BillingNextStep } from "@instrument-org/shared";

type Offer = RPCOutput["billing"]["offer"];
type OfferPlan = Offer["plans"][number];
type Status = RPCOutput["billing"]["status"];

/**
 * A refusal of a hosted request by our platform, as the chat reads it off
 * the failed message's body or a tool's output. `outcome` and `next` are
 * absent from refusals recorded before the platform sent them.
 */
export interface BillingRefusal {
  code: string;
  next?: BillingNextStep;
  outcome?: string;
  reason?: string;
  resetsAt?: string;
  window?: string;
}

/** `$10/month`, or nothing while Stripe's price has not been cached yet. */
export function formatPlanPrice(price: OfferPlan["price"]) {
  const amount = formatAmount(price);
  if (!amount) {
    return "";
  }
  return price?.interval ? `${amount}/${price.interval}` : amount;
}

/** `$10`, a plan's price alone. */
function formatAmount(price: OfferPlan["price"]) {
  if (!price || price.unitAmount === null) {
    return "";
  }
  return new Intl.NumberFormat("en-US", {
    currency: price.currency,
    maximumFractionDigits: price.unitAmount % 100 === 0 ? 0 : 2,
    style: "currency",
  }).format(price.unitAmount / 100);
}

/** `$10 a month`, the way Settings says what a plan costs. */
export function formatPriceInWords(price: OfferPlan["price"]) {
  const amount = formatAmount(price);
  if (!amount) {
    return "";
  }
  return price?.interval ? `${amount} a ${price.interval}` : amount;
}

/** Whether Instrument's models would run for the account now, as the platform says. */
function isActive(status: Status | undefined) {
  return status?.account.state === "active";
}

/** The offered plan a subscription pays for, for its price. */
export function subscribedPlan(
  status: Status | undefined,
  offer: Offer | undefined,
) {
  if (!status?.subscription) {
    return undefined;
  }
  const key = status.subscription.plan ?? status.plan;
  return offer?.plans.find((plan) => plan.key === key);
}

/** When a subscription that will not renew ends. */
export function subscriptionEndsAt(status: Status | undefined) {
  const subscription = status?.subscription;
  if (!subscription) {
    return undefined;
  }
  const at =
    subscription.cancelAt ??
    (subscription.cancelAtPeriodEnd
      ? subscription.currentPeriodEnd
      : undefined);
  return at ? new Date(at) : undefined;
}

/**
 * A downgrade waiting for the end of the period: when it happens, and the
 * plan it moves to, by the offer's name for it.
 */
export function scheduledPlanChange(
  status: Status | undefined,
  offer: Offer | undefined,
) {
  const change = status?.subscription?.scheduledChange;
  if (!change) {
    return undefined;
  }
  return {
    at: new Date(change.at),
    key: change.plan,
    name:
      offer?.plans.find((plan) => plan.key === change.plan)?.name ??
      change.plan,
  };
}

/**
 * When a moment comes round, said the way a person would: "at 3:40 PM" later
 * today, "tomorrow at 9:12 AM", "Monday at 9:12 AM" within the week, and
 * "November 5" past that.
 */
export function describeWhen(date: Date, now: Date) {
  const time = date.toLocaleTimeString(displayLocale, {
    hour: "numeric",
    minute: "2-digit",
  });
  const days = calendarDaysBetween(now, date);
  if (days <= 0) {
    return `at ${time}`;
  }
  if (days === 1) {
    return `tomorrow at ${time}`;
  }
  if (days < 7) {
    const weekday = date.toLocaleDateString(displayLocale, { weekday: "long" });
    return `${weekday} at ${time}`;
  }
  return describeDate(date, now);
}

/**
 * When a pause ends, after "until": "3:40 PM" later today, "tomorrow at
 * 9:12 AM", "Monday at 9:12 AM", "November 5".
 */
function describeUntil(date: Date, now: Date) {
  return describeWhen(date, now).replace(/^at /, "");
}

/** "November 5", with the year only when it is not this one. */
export function describeDate(date: Date, now: Date) {
  return date.toLocaleDateString(displayLocale, {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** "Sunday, October 11", for the end of a trial. */
export function describeDay(date: Date) {
  return date.toLocaleDateString(displayLocale, {
    day: "numeric",
    month: "long",
    weekday: "long",
  });
}

function calendarDaysBetween(from: Date, to: Date) {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

/**
 * What stands between the person and something Instrument does for them:
 * the platform refused it or would (`blocked`, with the platform's
 * `outcome` and the `next` step past it, and `refused` once a refusal
 * names it), or nobody is signed in (`sign-in`). `resumed` is a refusal
 * gone, with what lifted it, when what was stopped can go again.
 */
export type BillingNotice =
  | {
      kind: "blocked";
      next?: BillingNextStep;
      outcome: string;
      refused?: true;
      resetsAt?: Date;
    }
  | {
      after:
        | "access-revoked"
        | "limit-reset"
        | "payment-failed"
        | "subscribed"
        | "trial-started";
      kind: "resumed";
    }
  | { kind: "sign-in" };

/** A notice's name, for tests and the debug pages to find its note by. */
export function noticeName(notice: BillingNotice) {
  return notice.kind === "blocked" ? notice.outcome : notice.kind;
}

/**
 * A notice from what the platform said: a refusal's body, a feature's
 * availability, or the account's state. Undefined when it named no outcome,
 * as a refusal recorded before the platform sent one.
 */
function blockedNotice(
  said: { next?: BillingNextStep; outcome?: string; resetsAt?: string },
  refused: boolean,
): BillingNotice | undefined {
  if (!said.outcome) {
    return undefined;
  }
  const resetsAt = said.resetsAt ? new Date(said.resetsAt) : undefined;
  return {
    kind: "blocked",
    ...(said.next && { next: said.next }),
    outcome: said.outcome,
    ...(refused && { refused: true }),
    ...(resetsAt && !Number.isNaN(resetsAt.getTime()) && { resetsAt }),
  };
}

/**
 * What was held back: a turn on Instrument's models, an image, a dictation,
 * or a web search through Instrument.
 */
export type BlockedThing = "dictation" | "images" | "models" | "search";

/**
 * The notice for a refusal of `blocked`. `status` is only trusted when it
 * was read after the refusal: one read before it still describes the
 * account as it was when the request was sent. Read after, it is the
 * platform's word on whether the thing runs again, except that a trial the
 * platform refused as ended is lifted only by a plan, since the status can
 * call the trial running while what is left of it can't pay for a request.
 */
export function refusalNotice({
  blocked,
  now,
  refusal,
  refusedAt,
  status,
  statusReadAt,
}: {
  blocked: BlockedThing;
  now: Date;
  refusal: BillingRefusal;
  refusedAt: Date;
  status: Status | undefined;
  statusReadAt: number;
}): BillingNotice | undefined {
  const current =
    status && statusReadAt >= refusedAt.getTime() ? status : undefined;
  const availability = current?.features[blocked];
  const resetsAt = refusal.resetsAt ? new Date(refusal.resetsAt) : undefined;
  const isLimit = refusal.code === "usage-limit-exceeded";
  const lifted =
    (availability?.available === true &&
      (refusal.outcome !== "trial-ended" ||
        current?.account.tier === "paid")) ||
    (isLimit && resetsAt !== undefined && resetsAt <= now);
  if (lifted) {
    return {
      after: isLimit
        ? "limit-reset"
        : refusal.outcome === "access-revoked" ||
            refusal.outcome === "payment-failed"
          ? refusal.outcome
          : current?.account.tier === "trial"
            ? "trial-started"
            : "subscribed",
      kind: "resumed",
    };
  }
  return blockedNotice(
    availability && !availability.available ? availability : refusal,
    true,
  );
}

/**
 * The notice a chat on Instrument's models shows before any turn of its is
 * refused, when the platform says the next one would be.
 */
export function accountNotice(
  status: Status | undefined,
): BillingNotice | undefined {
  if (!status || isActive(status)) {
    return undefined;
  }
  return blockedNotice(
    { ...status.account, outcome: status.account.state },
    false,
  );
}

/**
 * What a notice's button does: one of the platform's next steps this build
 * knows, `website` for one it doesn't (opening the page the platform named),
 * or one of the app's own (`continue`, `sign-in`).
 */
export type NoticeAction = {
  kind:
    | "choose-plan"
    | "contact"
    | "continue"
    | "sign-in"
    | "start-trial"
    | "update-card"
    | "upgrade"
    | "website";
  label: string;
  /** The website page a `website` action opens. */
  page?: string;
  /** The plan the website's plans lead with. */
  plan?: string;
};

/** The button for the platform's next step, in this app's words where it knows the step. */
function actionFor(
  next: BillingNextStep | undefined,
  outcome: string,
): NoticeAction | undefined {
  if (!next) {
    return undefined;
  }
  const plan = next.plan ? { plan: next.plan } : {};
  switch (next.action) {
    case "choose-plan": {
      return { kind: "choose-plan", label: "Choose a plan", ...plan };
    }
    case "contact": {
      return {
        kind: "contact",
        label: outcome === "access-revoked" ? "Contact support" : "Contact us",
      };
    }
    case "start-trial": {
      return { kind: "start-trial", label: "Start free trial", ...plan };
    }
    case "update-card": {
      return { kind: "update-card", label: "Update card" };
    }
    case "upgrade": {
      return { kind: "upgrade", label: "Upgrade", ...plan };
    }
    default: {
      return next.page
        ? { kind: "website", label: next.label, page: next.page, ...plan }
        : undefined;
    }
  }
}

/** The words after "to" for what was held back: "make images". */
const PURPOSE = {
  dictation: "use dictation",
  images: "make images",
  models: `use ${APP_NAME}'s models`,
  search: `use ${APP_NAME}'s web search`,
} satisfies Record<BlockedThing, string>;

/** What paused, said as the start of its note's title. */
const PAUSED = {
  images: "Images are paused",
  search: `Web search through ${APP_NAME} is paused`,
} satisfies Partial<Record<BlockedThing, string>>;

/** Everything `nextStep` decides from. */
export type NextStepInput = {
  /** What was held back. */
  blocked: BlockedThing;
  /** What stands in the way (`refusalNotice`, `accountNotice`), or `sign-in`. */
  notice: BillingNotice;
  /**
   * Whether a model the person has could do it instead: another connection's
   * model for a turn. Never for an image, which the chat's own provider or
   * the person's own image keys would already have made.
   */
  otherModelCan: boolean;
  /** The account's tier as the platform names it, once read. */
  tier: string | undefined;
};

/** What to say, and the ways forward to offer, in the order to offer them. */
export type NextStep = {
  action?: NoticeAction;
  /** Whether Change model goes beside the action. */
  changeModel: boolean;
  line?: string;
  title: string;
};

/**
 * How to say a notice, with the way forward the platform gave for it. One
 * wording for every surface that meets a refusal (a chat's note, a
 * dictation toast, a sheet after sign-in). Change model only where another
 * model could do the job.
 */
export function nextStep(
  { blocked, notice, otherModelCan, tier }: NextStepInput,
  now: Date,
): NextStep {
  const changeModel = otherModelCan && notice.kind !== "resumed";
  const purpose = PURPOSE[blocked];
  switch (notice.kind) {
    case "blocked": {
      const action = actionFor(notice.next, notice.outcome);
      const step = { ...(action && { action }), changeModel };
      switch (notice.outcome) {
        case "access-revoked": {
          return {
            ...step,
            line: "Get in touch and we'll sort it out.",
            title: `${APP_NAME} isn't available on this account.`,
          };
        }
        case "limit-reached": {
          return {
            ...step,
            ...limitWords(blocked, notice.resetsAt, tier, now),
          };
        }
        case "payment-failed": {
          return {
            ...step,
            line: "Update your card to keep going.",
            title: "Your payment didn't go through.",
          };
        }
        case "plan-required": {
          return {
            ...step,
            title:
              notice.next?.action === "start-trial"
                ? `Start your free trial to ${purpose}.`
                : `Choose a plan to ${purpose}.`,
          };
        }
        case "trial-ended": {
          return { ...step, title: "Your free trial has ended." };
        }
        case "trials-unavailable": {
          // Said only once a refusal names it; before that, a plan is the
          // way in, and trials go unmentioned.
          return {
            ...step,
            title: notice.refused
              ? "Free trials aren't available right now."
              : `Choose a plan to ${purpose}.`,
          };
        }
        default: {
          return { ...step, title: `You can't ${purpose} right now.` };
        }
      }
    }
    case "resumed": {
      return {
        action: { kind: "continue", label: "Continue" },
        changeModel,
        title: RESUMED[notice.after],
      };
    }
    case "sign-in": {
      return {
        action: { kind: "sign-in", label: "Continue with Google" },
        changeModel,
        ...(blocked === "images"
          ? {
              line: "It works in any chat, whatever AI you use.",
              title: `Make images with a free ${APP_NAME} account.`,
            }
          : { title: `Sign in to ${purpose}.` }),
      };
    }
    default: {
      notice satisfies never;
      return { changeModel, title: "" };
    }
  }
}

const RESUMED = {
  "access-revoked": `${APP_NAME} is available again.`,
  "limit-reset": "Your usage limit has reset.",
  "payment-failed": "Your payment went through.",
  subscribed: "You're subscribed.",
  "trial-started": "Your free trial has started.",
} satisfies Record<
  Extract<BillingNotice, { kind: "resumed" }>["after"],
  string
>;

/**
 * A spent usage window, said for what it held back and whose usage it was.
 * An image or a search stops on its own while the chat goes on with the
 * person's own AI, so its note names what paused, not the chat.
 */
function limitWords(
  blocked: BlockedThing,
  resetsAt: Date | undefined,
  tier: string | undefined,
  now: Date,
): { line?: string; title: string } {
  if (blocked === "images" || blocked === "search") {
    const until = resetsAt
      ? `until ${describeUntil(resetsAt, now)}`
      : "for now";
    return {
      ...(tier !== undefined && {
        line:
          tier === "free"
            ? `Your free ${APP_NAME} usage ran out.`
            : tier === "trial"
              ? "Your free trial's usage ran out."
              : "Your plan's usage ran out.",
      }),
      title: `${PAUSED[blocked]} ${until}.`,
    };
  }
  return {
    line: resetsAt
      ? `It resets ${describeWhen(resetsAt, now)}.`
      : "It resets soon.",
    title:
      tier === "free"
        ? "You've reached your free account's limit for now."
        : tier === "trial"
          ? "You've reached your free trial's limit for now."
          : "You've reached your plan's limit for now.",
  };
}

/**
 * `nextStep` for a notice, with the tier read from the account as billing
 * last described it.
 */
export function nextStepFor(
  {
    blocked,
    notice,
    otherModelCan,
    status,
  }: {
    blocked: BlockedThing;
    notice: BillingNotice;
    otherModelCan: boolean;
    status: Status | undefined;
  },
  now: Date,
) {
  return nextStep(
    { blocked, notice, otherModelCan, tier: status?.account.tier },
    now,
  );
}

/**
 * The one plain line a refused turn ends on, in place of an error card.
 * Read off the refusal alone, so it says what happened then whatever the
 * account looks like now. Undefined for a refusal the chat still shows as an
 * error (a usage check that was down, a model that was not found).
 */
export function stopLineText(refusal: BillingRefusal) {
  if (refusal.code === "concurrency-limit") {
    return "Stopped: too many of your tasks were running at once.";
  }
  if (
    refusal.code !== "subscription-required" &&
    refusal.code !== "usage-limit-exceeded"
  ) {
    return undefined;
  }
  switch (refusal.outcome ?? recordedOutcome(refusal.reason)) {
    case "access-revoked": {
      return `Stopped: ${APP_NAME} isn't available on this account.`;
    }
    case "payment-failed": {
      return "Stopped: your payment didn't go through.";
    }
    case "plan-required": {
      return refusal.next?.action === "start-trial" ||
        refusal.reason === "trial-available"
        ? "Stopped: start your free trial to keep going."
        : `Stopped: ${APP_NAME} needs a plan.`;
    }
    case "trial-ended": {
      return "Stopped: your free trial has ended.";
    }
    case "trials-unavailable": {
      return "Stopped: free trials aren't available right now.";
    }
    default: {
      return refusal.code === "usage-limit-exceeded"
        ? "Stopped: you've reached your plan's limit for now."
        : `Stopped: ${APP_NAME} needs a plan.`;
    }
  }
}

/**
 * The outcome a refusal recorded before the platform sent one stands for,
 * read from its `reason`, so an older chat keeps the line it was refused with.
 */
function recordedOutcome(reason: string | undefined) {
  switch (reason) {
    case "access-revoked":
    case "payment-failed":
    case "trial-ended": {
      return reason;
    }
    case "trial-used": {
      return "trial-ended";
    }
    case "trial-capacity":
    case "trial-paused": {
      return "trials-unavailable";
    }
    case "no-plan":
    case "trial-available": {
      return "plan-required";
    }
    default: {
      return undefined;
    }
  }
}

/** The share of an allowance at which the chat first mentions it. */
const USAGE_WARNING_PERCENT = 80;

/**
 * The quiet line over the reply box once 80% of the trial or of any usage
 * window is gone. `key` names this warning for this window's period, so
 * dismissing it holds until the next period reaches 80% again.
 */
export type UsageWarning =
  | { endsAt?: Date; key: string; kind: "trial"; percent: number }
  | {
      key: string;
      kind: "window";
      percent: number;
      /** The window's words after "for": "this week". */
      period: string;
      resetsAt?: Date;
    };

export function usageWarning(
  status: Status | undefined,
): UsageWarning | undefined {
  if (!status || !isActive(status)) {
    return undefined;
  }
  const percent = status.trial.percentUsed;
  if (
    status.account.tier === "trial" &&
    status.trial.state === "active" &&
    percent !== undefined &&
    percent >= USAGE_WARNING_PERCENT &&
    percent < 100
  ) {
    return {
      ...(status.trial.endsAt && { endsAt: new Date(status.trial.endsAt) }),
      key: `trial:${status.trial.endsAt ?? ""}`,
      kind: "trial",
      percent: Math.floor(percent),
    };
  }
  const fullest = status.windows
    .filter(
      (window) =>
        window.percentUsed >= USAGE_WARNING_PERCENT && window.percentUsed < 100,
    )
    .toSorted((a, b) => b.percentUsed - a.percentUsed)[0];
  if (!fullest) {
    return undefined;
  }
  return {
    key: `${fullest.key}:${fullest.resetsAt ?? ""}`,
    kind: "window",
    percent: Math.floor(fullest.percentUsed),
    period: fullest.period,
    ...(fullest.resetsAt && { resetsAt: new Date(fullest.resetsAt) }),
  };
}

export function usageWarningText(warning: UsageWarning, now: Date) {
  if (warning.kind === "trial") {
    const ends = warning.endsAt
      ? ` It ends ${describeDate(warning.endsAt, now)} or when it runs out.`
      : "";
    return `${warning.percent}% of your free trial is used.${ends}`;
  }
  const resets = warning.resetsAt
    ? ` It resets ${describeWhen(warning.resetsAt, now)}.`
    : "";
  return `You've used ${warning.percent}% of your plan for ${warning.period}.${resets}`;
}

/** A hosted feature `billing.status` reports on. */
export type HostedFeature = keyof Status["features"];

/**
 * Why a hosted feature is refused now, when the status says it is: the
 * refusal code and outcome, what unlocks it and the way past it, and when a
 * spent allowance comes back.
 * Undefined while it runs, and for a platform that does not report it (no
 * `dictation` entry), which leaves the feature to try.
 * A pause whose reset has passed counts as over before the next read.
 */
export function featurePause(
  status: Status | undefined,
  feature: HostedFeature,
  now: Date,
) {
  const availability = status?.features[feature];
  if (!availability || availability.available) {
    return undefined;
  }
  const resetsAt = availability.resetsAt
    ? new Date(availability.resetsAt)
    : undefined;
  if (resetsAt && resetsAt.getTime() <= now.getTime()) {
    return undefined;
  }
  return {
    code: availability.code,
    ...(availability.next && { next: availability.next }),
    outcome: availability.outcome,
    reason: availability.reason,
    ...(resetsAt && { resetsAt }),
  };
}

/**
 * The free allowance's features spent until a reset: which of them, and when
 * they come back. Only for an account on the free allowance; a plan's own
 * limits are the usage notices'.
 */
export function freeAllowancePause(status: Status | undefined, now: Date) {
  if (status?.account.tier !== "free") {
    return undefined;
  }
  const paused = FREE_FEATURES.flatMap((feature) => {
    const pause = featurePause(status, feature, now);
    return pause?.code === "usage-limit-exceeded" ? [{ feature, pause }] : [];
  });
  if (paused.length === 0) {
    return undefined;
  }
  return {
    features: paused.map(({ feature }) => feature),
    resetsAt: paused[0]?.pause.resetsAt,
  };
}

/** The features a free allowance can spend, in the order Settings names them. */
const FREE_FEATURES = [
  "search",
  "images",
  "decisions",
  "dictation",
] as const satisfies HostedFeature[];

/**
 * Whether the platform's way into Instrument's models for this account is
 * starting the free trial.
 */
export function offersTrial(status: Status | undefined) {
  return status?.account.next?.action === "start-trial";
}

/**
 * What the model picker says in place of Instrument's models while the
 * account has no way to use them: the platform's outcome and next step.
 * Undefined while they run, and while only a usage window is spent, which
 * passes on its own.
 */
export function modelsHeldBack(status: Status | undefined, now: Date) {
  const notice = accountNotice(status);
  if (notice?.kind !== "blocked" || notice.outcome === "limit-reached") {
    return undefined;
  }
  return nextStep(
    {
      blocked: "models",
      notice,
      otherModelCan: false,
      tier: status?.account.tier,
    },
    now,
  );
}

/**
 * What Auto's row in the model picker says about paying for it: that the
 * plan or the free trial includes it, and nothing while the account has
 * neither, or before its status is read.
 */
export function autoIncludedLine(status: Status | undefined) {
  if (!isActive(status)) {
    return undefined;
  }
  return status?.account.tier === "trial"
    ? "Included with your free trial"
    : "Included with your plan";
}

/** How long a dismissed note about something Instrument offers stays away. */
export const NOTE_DISMISSED_FOR_MS = 7 * 86_400_000;

/**
 * What a dismissal is kept under: what was held back and why, so dismissing
 * the image note for a spent allowance says nothing of the search note, or of
 * the image note for a sign-in.
 */
export function noteDismissalKey(blocked: BlockedThing, why: string) {
  return `${blocked}:${why}`;
}

/**
 * Whether a note stays hidden now: dismissed less than a week ago, and not
 * a block of the person's own message, which a dismissal never hides. Once
 * the week is out, the next refusal for the same reason shows it again.
 */
export function isNoteDismissed({
  blocksOwnSend,
  dismissedAt,
  now,
}: {
  blocksOwnSend: boolean;
  dismissedAt: number | undefined;
  now: number;
}) {
  return (
    !blocksOwnSend &&
    dismissedAt !== undefined &&
    now >= dismissedAt &&
    now - dismissedAt < NOTE_DISMISSED_FOR_MS
  );
}

/**
 * The dismissals kept for a workspace with `key` set to `now`, dropping the
 * ones whose week is out, so the record never grows past the notes there are.
 */
export function withNoteDismissed(
  dismissals: Record<string, number>,
  key: string,
  now: number,
) {
  return Object.fromEntries(
    [...Object.entries(dismissals), [key, now] as const].filter(
      ([, at]) => now - at < NOTE_DISMISSED_FOR_MS,
    ),
  );
}

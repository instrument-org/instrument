import { type RPCOutput } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { ORPCError } from "@orpc/client";
import { PAYMENT_FAILED_STATUSES } from "@/shared/billing";

type Offer = RPCOutput["billing"]["offer"];
type OfferPlan = Offer["plans"][number];
type Status = RPCOutput["billing"]["status"];

/**
 * A refusal of a hosted request by our platform, as the chat reads it off
 * the failed message's body.
 */
export interface BillingRefusal {
  code: string;
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

/** `$10`, the number on a plan's card and its button. */
export function formatAmount(price: OfferPlan["price"]) {
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

/**
 * The trial a new subscriber gets through Checkout, in one line, or nothing
 * when the offer has none for this account (or its trial starts in the app).
 */
export function checkoutTrialLine(offer: Offer | undefined) {
  const trial = offer?.trial;
  if (!trial || trial.available === false) {
    return undefined;
  }
  if (trial.mode === "intro" && trial.intro) {
    const amount = formatAmount({ ...trial.intro.price, interval: null });
    return trial.intro.months === 1
      ? `Your first month is ${amount}.`
      : `Your first ${trial.intro.months} months are ${amount} each.`;
  }
  if (
    trial.mode === "card" ||
    (trial.mode === undefined && trial.cardRequired)
  ) {
    return `Free for ${trial.days} days. You won't be charged if you cancel before it ends.`;
  }
  return undefined;
}

/**
 * A subscription's Stripe trial or intro price, while it runs: what the plan
 * row says in place of its renewal date.
 */
export function subscriptionPhaseLine(
  status: Status | undefined,
  price: string,
  now: Date,
) {
  const phase = status?.subscription?.phase;
  if (!phase) {
    return undefined;
  }
  const until = phase.endsAt
    ? ` until ${describeDate(new Date(phase.endsAt), now)}`
    : "";
  const then = price ? `, then ${price}` : "";
  return phase.key === "trialing"
    ? `Free trial${until}${then}`
    : `Intro price${until}${then}`;
}

/**
 * How much AI a plan carries, against the first plan offered: "Standard" for
 * that one, "4× Standard" for one with four times its limits. Never dollars.
 */
export function allowanceLabel(plan: OfferPlan) {
  const multiple = plan.allowance.multiple;
  return multiple <= 1 ? "Standard" : `${multiple}× Standard`;
}

/**
 * A trial refused for now rather than used up: the month's trials are spent
 * (`trial-capacity`) or new ones are paused (`trial-paused`). Only a plan
 * gets this account going until they open again.
 */
function isTrialHeldBackReason(reason: string | undefined) {
  return reason === "trial-capacity" || reason === "trial-paused";
}

/**
 * Whether this account's trial is still to be had but can't start now. The
 * status keeps calling it available while trials are paused or the month's
 * are spent, and the offer, signed in, drops the trial then. A trial already
 * taken stays in the offer, marked unavailable.
 */
export function isTrialHeldBack(
  status: Status | undefined,
  offer: Offer | undefined,
) {
  return (
    status?.trial.state === "available" &&
    !status.subscription &&
    offer !== undefined &&
    offer.trial === null
  );
}

export function hasPaymentFailed(status: Status | undefined) {
  return (
    status?.subscription !== undefined &&
    PAYMENT_FAILED_STATUSES.has(status.subscription.status)
  );
}

/**
 * Access the API revoked after a dispute or a fraud warning, which only
 * support can restore. With a subscription, it is one paid up that entitles
 * nothing. Without one, it is being refused Checkout: the API says
 * `canSubscribe: false` only while a subscription can still charge or while
 * access is revoked.
 */
export function isAccessRevoked(status: Status | undefined) {
  if (status?.plan !== "none") {
    return false;
  }
  return status.subscription === undefined
    ? !status.canSubscribe
    : !hasPaymentFailed(status);
}

/** A live subscription to one of the offered plans, whatever its payment state. */
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

/**
 * Whether the account has no plan for Instrument's models: none at all
 * (`none`, refused outright), or the free allowance (`free`), which covers
 * decisions and web search alone.
 */
export function hasNoPlan(status: Status | undefined) {
  return status?.plan === "none" || status?.plan === "free";
}

/** Whether the next hosted request would be let through, by what status says. */
function canUseHostedModels(status: Status) {
  if (hasNoPlan(status) || hasPaymentFailed(status)) {
    return false;
  }
  if (status.plan === "trial") {
    return status.trial.state !== "ended";
  }
  return true;
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
 * Whether `plan` costs less than the one this account pays for, which the
 * API holds until the period ends rather than applying now.
 */
export function isDowngrade(
  plan: OfferPlan,
  status: Status | undefined,
  offer: Offer | undefined,
) {
  const from = subscribedPlan(status, offer)?.price?.unitAmount;
  const to = plan.price?.unitAmount;
  return typeof from === "number" && typeof to === "number" && to < from;
}

/**
 * The `data.code` a platform refusal carries (`cancel-scheduled`, say), when
 * the error is one.
 */
export function platformRefusalCode(error: unknown) {
  if (!(error instanceof ORPCError)) {
    return undefined;
  }
  const data: unknown = error.data;
  return typeof data === "object" &&
    data !== null &&
    "code" in data &&
    typeof data.code === "string"
    ? data.code
    : undefined;
}

/**
 * What a plan card's button does for this account: subscribe, switch a live
 * subscription to it, start the trial on it, or nothing, on the plan they are
 * on. While a downgrade waits, the plan they are on offers to keep it, and
 * the plan it moves to offers nothing.
 */
export type PlanCardAction =
  | "current"
  | "keep"
  | "scheduled"
  | "subscribe"
  | "switch"
  | "trial";

export function planCardAction(
  plan: OfferPlan,
  status: Status | undefined,
  { trial = false }: { trial?: boolean } = {},
): PlanCardAction {
  const scheduled = status?.subscription?.scheduledChange?.plan;
  if (
    status?.subscription &&
    (status.subscription.plan ?? status.plan) === plan.key
  ) {
    return scheduled ? "keep" : "current";
  }
  if (scheduled === plan.key) {
    return "scheduled";
  }
  if (status?.subscription && !status.canSubscribe) {
    return "switch";
  }
  return trial ? "trial" : "subscribe";
}

/** The plan above the one this account pays for, when there is one. */
export function upgradePlan(
  offer: Offer | undefined,
  status: Status | undefined,
) {
  const current = subscribedPlan(status, offer);
  if (!current || !offer) {
    return undefined;
  }
  return offer.plans
    .filter((plan) => plan.allowance.multiple > current.allowance.multiple)
    .toSorted((a, b) => a.allowance.multiple - b.allowance.multiple)[0];
}

/**
 * When a moment comes round, said the way a person would: "at 3:40 PM" later
 * today, "tomorrow at 9:12 AM", "Monday at 9:12 AM" within the week, and
 * "November 5" past that.
 */
export function describeWhen(date: Date, now: Date) {
  const time = date.toLocaleTimeString("en-US", {
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
    const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
    return `${weekday} at ${time}`;
  }
  return describeDate(date, now);
}

/** "November 5", with the year only when it is not this one. */
export function describeDate(date: Date, now: Date) {
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** "Sunday, October 11", for the end of a trial. */
export function describeDay(date: Date) {
  return date.toLocaleDateString("en-US", {
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

/** A usage window's name, as Settings labels its meter. */
export function windowLabel(key: string) {
  switch (key) {
    case "5h": {
      return "Current 5 hours";
    }
    case "month": {
      return "This month";
    }
    case "week": {
      return "This week";
    }
    default: {
      return key;
    }
  }
}

/**
 * What the chat says over its reply box after the platform refused a turn,
 * or once the reason for the refusal has gone (`resumed`), when the stopped
 * turn can be sent again.
 */
export type BillingNotice =
  | { kind: "access-revoked" }
  | { kind: "payment-failed" }
  | { kind: "plan-limit"; resetsAt?: Date; upgradeTo?: OfferPlan }
  | {
      kind: "plan-required";
      reason?: string;
      // What Checkout starts with, for a trial that needs one.
      trialLine?: string;
    }
  | {
      /** What the refusal was about, when it was not a missing plan. */
      after?: "access-revoked" | "payment-failed" | "trial-started";
      kind: "resumed";
      subscribed: boolean;
    }
  | { kind: "trial-ended" };

/**
 * The notice for a refused turn. `status` is only trusted when it was read
 * after the refusal: one read before it still describes the account as it
 * was when the turn was sent.
 */
export function refusalNotice({
  now,
  offer,
  refusal,
  refusedAt,
  status,
  statusReadAt,
}: {
  now: Date;
  offer: Offer | undefined;
  refusal: BillingRefusal;
  refusedAt: Date;
  status: Status | undefined;
  statusReadAt: number;
}): BillingNotice | undefined {
  const current =
    status && statusReadAt >= refusedAt.getTime() ? status : undefined;
  switch (refusal.code) {
    case "subscription-required": {
      // Only a plan bought since lifts this refusal. A trial the status still
      // calls active was refused on what this request would have cost, so it
      // is as over as the refusal says.
      if (current?.subscription && canUseHostedModels(current)) {
        return {
          ...((refusal.reason === "access-revoked" ||
            refusal.reason === "payment-failed") && { after: refusal.reason }),
          kind: "resumed",
          subscribed: true,
        };
      }
      // The trial the refusal offered has started since.
      if (
        refusal.reason === "trial-available" &&
        current?.plan === "trial" &&
        canUseHostedModels(current)
      ) {
        return { after: "trial-started", kind: "resumed", subscribed: false };
      }
      if (refusal.reason === "access-revoked") {
        return { kind: "access-revoked" };
      }
      if (refusal.reason === "payment-failed" || hasPaymentFailed(current)) {
        return { kind: "payment-failed" };
      }
      if (refusal.reason === "trial-ended" || refusal.reason === "trial-used") {
        return { kind: "trial-ended" };
      }
      const trialLine =
        refusal.reason === "card-required"
          ? checkoutTrialLine(offer)
          : undefined;
      return {
        kind: "plan-required",
        ...(refusal.reason && { reason: refusal.reason }),
        ...(trialLine && { trialLine }),
      };
    }
    case "usage-limit-exceeded": {
      const resetsAt = refusal.resetsAt ? new Date(refusal.resetsAt) : null;
      const hasReset =
        (resetsAt !== null && resetsAt.getTime() <= now.getTime()) ||
        (current !== undefined &&
          canUseHostedModels(current) &&
          current.windows.every((window) => window.percentUsed < 100));
      if (hasReset) {
        return { kind: "resumed", subscribed: false };
      }
      const upgradeTo = upgradePlan(offer, status);
      return {
        kind: "plan-limit",
        ...(resetsAt && !Number.isNaN(resetsAt.getTime()) && { resetsAt }),
        ...(upgradeTo && { upgradeTo }),
      };
    }
    default: {
      return undefined;
    }
  }
}

/**
 * The notice a chat on Instrument's models shows before any turn of its is
 * refused, when the account as last read says the next one would be: access
 * revoked, a failed payment, a trial over with no plan, or a usage window
 * spent, or the free allowance, which leaves Instrument's models to a plan
 * or a trial the person starts.
 */
export function accountNotice(
  status: Status | undefined,
  offer: Offer | undefined,
): BillingNotice | undefined {
  if (!status) {
    return undefined;
  }
  if (isAccessRevoked(status)) {
    return { kind: "access-revoked" };
  }
  if (hasPaymentFailed(status)) {
    return { kind: "payment-failed" };
  }
  if (
    (hasNoPlan(status) || status.plan === "trial") &&
    !status.subscription &&
    status.trial.state === "ended"
  ) {
    return { kind: "trial-ended" };
  }
  const models = status.features?.models;
  if (status.plan === "free" && models && !models.available) {
    return {
      kind: "plan-required",
      ...(models.reason && { reason: models.reason }),
    };
  }
  if (!canUseHostedModels(status)) {
    return undefined;
  }
  // Of the windows spent, the one that comes back last is the one in the way.
  const resets = status.windows
    .filter((window) => window.percentUsed >= 100)
    .map((window) =>
      window.resetsAt ? new Date(window.resetsAt) : new Date(Number.NaN),
    );
  if (resets.length === 0) {
    return undefined;
  }
  const known = resets.filter((date) => !Number.isNaN(date.getTime()));
  const resetsAt =
    known.length === resets.length
      ? known.toSorted((a, b) => b.getTime() - a.getTime())[0]
      : undefined;
  const upgradeTo = upgradePlan(offer, status);
  return {
    kind: "plan-limit",
    ...(resetsAt && { resetsAt }),
    ...(upgradeTo && { upgradeTo }),
  };
}

/** What a notice's buttons do. */
export type BillingNoticeAction =
  | "choose-plan"
  | "contact-support"
  | "continue"
  | "start-trial"
  | "update-card"
  | "upgrade";

export function noticeCopy(
  notice: BillingNotice,
  now: Date,
): {
  action?: { kind: BillingNoticeAction; label: string };
  /** A second way forward beside the first, quieter. */
  secondary?: { kind: BillingNoticeAction; label: string };
  line?: string;
  title: string;
} {
  const choosePlan = { kind: "choose-plan" as const, label: "Choose a plan" };
  switch (notice.kind) {
    case "access-revoked": {
      return {
        action: { kind: "contact-support", label: "Contact support" },
        line: "Get in touch and we'll sort it out.",
        title: `${APP_NAME} isn't available on this account.`,
      };
    }
    case "payment-failed": {
      return {
        action: { kind: "update-card", label: "Update card" },
        line: "Update your card to keep going.",
        title: "Your payment didn't go through.",
      };
    }
    case "plan-limit": {
      const resets = notice.resetsAt
        ? `It resets ${describeWhen(notice.resetsAt, now)}.`
        : "It resets soon.";
      return {
        ...(notice.upgradeTo && {
          action: { kind: "upgrade" as const, label: "Upgrade" },
        }),
        line: resets,
        title: "You've reached your plan's limit for now.",
      };
    }
    case "plan-required": {
      if (notice.reason === "trial-available") {
        return {
          action: { kind: "start-trial", label: "Start free trial" },
          secondary: choosePlan,
          title: `Start your free trial to use ${APP_NAME}'s models.`,
        };
      }
      if (isTrialHeldBackReason(notice.reason)) {
        return {
          action: choosePlan,
          title: "Free trials aren't available right now.",
        };
      }
      return {
        action: choosePlan,
        ...(notice.reason === "card-required" &&
          notice.trialLine && { line: notice.trialLine }),
        title:
          notice.reason === "card-required"
            ? "Choose a plan to start."
            : `${APP_NAME} needs a plan.`,
      };
    }
    case "resumed": {
      return {
        action: { kind: "continue", label: "Continue" },
        title:
          notice.after === "payment-failed"
            ? "Your payment went through."
            : notice.after === "trial-started"
              ? "Your free trial has started."
              : notice.after === "access-revoked"
                ? `${APP_NAME} is available again.`
                : notice.subscribed
                  ? "You're subscribed."
                  : "Your usage limit has reset.",
      };
    }
    case "trial-ended": {
      return {
        action: choosePlan,
        title: "Your free trial has ended.",
      };
    }
    default: {
      notice satisfies never;
      return { title: "" };
    }
  }
}

/**
 * The one plain line a refused turn ends on, in place of an error card.
 * Read off the refusal alone, so it says what happened then whatever the
 * account looks like now. Undefined for a refusal the chat still shows as an
 * error (a usage check that was down, a model that was not found).
 */
export function stopLineText(refusal: BillingRefusal) {
  switch (refusal.code) {
    case "concurrency-limit": {
      return "Stopped: too many of your tasks were running at once.";
    }
    case "subscription-required": {
      switch (refusal.reason) {
        case "access-revoked": {
          return `Stopped: ${APP_NAME} isn't available on this account.`;
        }
        case "card-required": {
          return "Stopped: choose a plan to start.";
        }
        case "payment-failed": {
          return "Stopped: your payment didn't go through.";
        }
        case "trial-available": {
          return "Stopped: start your free trial to keep going.";
        }
        case "trial-capacity":
        case "trial-paused": {
          return "Stopped: free trials aren't available right now.";
        }
        case "trial-ended":
        case "trial-used": {
          return "Stopped: your free trial has ended.";
        }
        default: {
          return `Stopped: ${APP_NAME} needs a plan.`;
        }
      }
    }
    case "usage-limit-exceeded": {
      return "Stopped: you've reached your plan's limit for now.";
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
      resetsAt?: Date;
      window: string;
    };

export function usageWarning(
  status: Status | undefined,
): UsageWarning | undefined {
  if (!status || !canUseHostedModels(status)) {
    return undefined;
  }
  const percent = status.trial.percentUsed;
  if (
    status.plan === "trial" &&
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
    ...(fullest.resetsAt && { resetsAt: new Date(fullest.resetsAt) }),
    window: fullest.key,
  };
}

export function usageWarningText(warning: UsageWarning, now: Date) {
  if (warning.kind === "trial") {
    const ends = warning.endsAt
      ? ` It ends ${describeDate(warning.endsAt, now)} or when it runs out.`
      : "";
    return `${warning.percent}% of your free trial is used.${ends}`;
  }
  const period =
    warning.window === "5h"
      ? "the current 5 hours"
      : warning.window === "week"
        ? "this week"
        : warning.window === "month"
          ? "this month"
          : "this period";
  const resets = warning.resetsAt
    ? ` It resets ${describeWhen(warning.resetsAt, now)}.`
    : "";
  return `You've used ${warning.percent}% of your plan for ${period}.${resets}`;
}

/** A hosted feature `billing.status` reports on. */
export type HostedFeature = keyof NonNullable<Status["features"]>;

/**
 * Why a hosted feature is refused now, when the status says it is: the
 * refusal code, what unlocks it, and when a spent allowance comes back.
 * Undefined while it runs, and for a platform that does not report it (no
 * `features` yet, or no `dictation` entry), which leaves the feature to try.
 * A pause whose reset has passed counts as over before the next read.
 */
export function featurePause(
  status: Status | undefined,
  feature: HostedFeature,
  now: Date,
) {
  const availability = status?.features?.[feature];
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
    reason: availability.reason,
    ...(resetsAt && { resetsAt }),
  };
}

/**
 * The free allowance's decisions and search spent until a reset: when they
 * come back. Only for an account on the free allowance; a plan's own limits
 * are the usage notices'.
 */
export function freeAllowancePause(status: Status | undefined, now: Date) {
  if (status?.plan !== "free") {
    return undefined;
  }
  const paused = [
    featurePause(status, "search", now),
    featurePause(status, "decisions", now),
  ].find((pause) => pause?.code === "usage-limit-exceeded");
  return paused && { resetsAt: paused.resetsAt };
}

/**
 * Whether this account can start its no-card trial in the app now: it has
 * never had one or a subscription, trials are open, and the offer's trial
 * starts here rather than through Checkout.
 */
export function canStartTrial(
  status: Status | undefined,
  offer: Offer | undefined,
) {
  return (
    status !== undefined &&
    status.plan !== "trial" &&
    status.trial.state === "available" &&
    !status.subscription &&
    offer?.trial?.available === true &&
    !offer.trial.cardRequired
  );
}

/**
 * What Auto's row in the model picker says about paying for it: that the
 * plan or the free trial includes it, and nothing while the account has
 * neither, or before its status is read.
 */
export function autoIncludedLine(status: Status | undefined) {
  if (!status || !canUseHostedModels(status)) {
    return undefined;
  }
  return status.plan === "trial"
    ? "Included with your free trial"
    : "Included with your subscription";
}

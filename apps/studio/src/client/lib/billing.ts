import { type RPCOutput } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";

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
 * How much AI a plan carries, against the first plan offered: "Standard" for
 * that one, "4× Standard" for one with four times its limits. Never dollars.
 */
export function allowanceLabel(plan: OfferPlan) {
  const multiple = plan.allowance.multiple;
  return multiple <= 1 ? "Standard" : `${multiple}× Standard`;
}

/** Subscription states in which the last payment failed and is still owed. */
const PAYMENT_FAILED_STATUSES = new Set(["incomplete", "past_due", "unpaid"]);

export function hasPaymentFailed(status: Status | undefined) {
  return (
    status?.subscription !== undefined &&
    PAYMENT_FAILED_STATUSES.has(status.subscription.status)
  );
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

/** Whether the next hosted request would be let through, by what status says. */
function canUseHostedModels(status: Status) {
  if (status.plan === "none" || hasPaymentFailed(status)) {
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
 * What a plan card's button does for this account: subscribe, switch a live
 * subscription to it, start the trial on it, or nothing, on the plan they are
 * on.
 */
export type PlanCardAction = "current" | "subscribe" | "switch" | "trial";

export function planCardAction(
  plan: OfferPlan,
  status: Status | undefined,
  { trial = false }: { trial?: boolean } = {},
): PlanCardAction {
  if (
    status?.subscription &&
    (status.subscription.plan ?? status.plan) === plan.key
  ) {
    return "current";
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
  | { kind: "plan-required"; reason?: string }
  | { kind: "resumed"; subscribed: boolean }
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
        return { kind: "resumed", subscribed: true };
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
      return {
        kind: "plan-required",
        ...(refusal.reason && { reason: refusal.reason }),
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

/** What a notice's one button does. */
export type BillingNoticeAction =
  | "choose-plan"
  | "continue"
  | "update-card"
  | "upgrade";

export function noticeCopy(
  notice: BillingNotice,
  now: Date,
): {
  action?: { kind: BillingNoticeAction; label: string };
  line: string;
  title: string;
} {
  const choosePlan = { kind: "choose-plan" as const, label: "Choose a plan" };
  switch (notice.kind) {
    case "access-revoked": {
      return {
        line: "Contact support.",
        title: `${APP_NAME}'s AI isn't available on this account`,
      };
    }
    case "payment-failed": {
      return {
        action: { kind: "update-card", label: "Update card" },
        line: "Update your card to keep going.",
        title: "Your payment didn't go through",
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
        title: "You've reached your plan's limit for now",
      };
    }
    case "plan-required": {
      return {
        action: choosePlan,
        line:
          notice.reason === "card-required"
            ? "Add a card to start it, or switch to your own model."
            : "Choose a plan, or switch to your own model.",
        title:
          notice.reason === "card-required"
            ? "Start your free trial"
            : `${APP_NAME}'s AI needs a plan`,
      };
    }
    case "resumed": {
      return {
        action: { kind: "continue", label: "Continue" },
        line: "Pick up where this chat stopped.",
        title: notice.subscribed
          ? "You're subscribed"
          : "Your plan has room again",
      };
    }
    case "trial-ended": {
      return {
        action: choosePlan,
        line: "Choose a plan, or switch to your own model.",
        title: "Your free trial has ended",
      };
    }
    default: {
      notice satisfies never;
      return { line: "", title: "" };
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
          return `Stopped: ${APP_NAME}'s AI isn't available on this account.`;
        }
        case "card-required": {
          return "Stopped: a card is needed to start your free trial.";
        }
        case "payment-failed": {
          return "Stopped: your payment didn't go through.";
        }
        case "trial-ended":
        case "trial-used": {
          return "Stopped: your free trial has ended.";
        }
        default: {
          return `Stopped: ${APP_NAME}'s AI needs a plan.`;
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

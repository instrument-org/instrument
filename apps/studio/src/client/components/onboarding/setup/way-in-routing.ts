import {
  type SetupAnswers,
  type SetupStep,
} from "@/client/components/onboarding/setup/flow";

type ConnectTrouble = NonNullable<SetupAnswers["connectTrouble"]>;

/**
 * What a ChatGPT or Claude account said about its plan as it connected, or
 * that the connection failed for a reason we can't name.
 */
export type PlanReport =
  | { kind: "could-not-connect" }
  | { kind: "no-paid-plan" }
  | { kind: "out-of-usage"; resetsAt: string | undefined }
  | { kind: "paid" };

/**
 * Where a ChatGPT sign-in that succeeded goes next.
 *
 * Seam: the ChatGPT account route (`chatgptAccount.signIn`) answers only
 * whether the sign-in worked and whether plan use was allowed. Nothing it
 * reads tells a paid plan from a free one, or says the plan is out of usage
 * and when it comes back; both only show up later, as a refused model
 * request (`subscription_sharing_invalid_user`,
 * `subscription_sharing_usage_limit_exceeded`). Until the route reports a
 * plan, every signed-in account reads as paid.
 */
export function chatGPTPlanReport(): PlanReport {
  return { kind: "paid" };
}

/**
 * What Claude Code says about the account it just signed in to. A sign-in
 * through an API key or a cloud provider is not a plan; Claude Code names a
 * free account's plan "free" (an assumption: the paid ones read "pro" and
 * "max"). Any usage window at 100% means the plan is out of usage until the
 * last full window starts over.
 */
export function claudePlanReport({
  plan,
  signedInToPlan,
  usage,
}: {
  plan: string | undefined;
  signedInToPlan: boolean;
  usage: { resetsAt: string | undefined; used: number }[] | null;
}): PlanReport {
  if (!signedInToPlan || plan?.toLowerCase() === "free") {
    return { kind: "no-paid-plan" };
  }
  const spent = (usage ?? []).filter((window) => window.used >= 100);
  if (spent.length === 0) {
    return { kind: "paid" };
  }
  const resets = spent
    .map((window) => window.resetsAt)
    .filter((resetsAt) => resetsAt !== undefined)
    .toSorted();
  return { kind: "out-of-usage", resetsAt: resets.at(-1) };
}

/** The page after an account connects, and what setup keeps about it. */
export function stepAfterConnect({
  provider,
  report,
}: {
  provider: ConnectTrouble["provider"];
  report: PlanReport;
}): {
  answers: Pick<SetupAnswers, "connectTrouble" | "isOutOfUsage">;
  step: SetupStep;
} {
  switch (report.kind) {
    case "paid":
      return {
        answers: { connectTrouble: null, isOutOfUsage: false },
        step: "free-account",
      };
    case "could-not-connect":
    case "no-paid-plan":
      return {
        answers: {
          connectTrouble: { provider, reason: report.kind },
          isOutOfUsage: false,
        },
        step: "no-paid-plan",
      };
    case "out-of-usage":
      return {
        answers: {
          connectTrouble: {
            provider,
            reason: "out-of-usage",
            resetsAt: report.resetsAt,
          },
          isOutOfUsage: true,
        },
        step: "out-of-usage",
      };
  }
}

/**
 * When usage comes back, as a person would say it: the time alone today, the
 * weekday and time within the week, the date after that.
 */
export function describeResetTime(
  resetsAt: string,
  { locale, now = new Date() }: { locale?: string; now?: Date } = {},
): string {
  const at = new Date(resetsAt);
  const time = at.toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
  });
  if (at.toDateString() === now.toDateString()) {
    return time;
  }
  const days = (at.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
  if (days > 0 && days < 6) {
    const weekday = at.toLocaleDateString(locale, { weekday: "long" });
    return `${weekday} at ${time}`;
  }
  return at.toLocaleDateString(locale, { day: "numeric", month: "long" });
}

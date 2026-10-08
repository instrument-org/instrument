import {
  type SetupAnswers,
  type SetupStep,
} from "@/client/components/onboarding/setup/flow";
import { type RPCOutput } from "@/client/rpc/client";

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

/** What the account check says about a ChatGPT or Claude account. */
export type AccountCheck = RPCOutput["claudeAccount"]["check"];

/**
 * Where an account check sends setup. An account that signed out, or a
 * check that could not tell (offline, an unexpected answer), reads as a
 * connection that failed: the page says so and offers another try or
 * another way in, never a way through on an account nobody checked.
 */
export function reportFromCheck(check: AccountCheck): PlanReport {
  switch (check.state) {
    case "ready":
      return { kind: "paid" };
    case "not-eligible":
      return { kind: "no-paid-plan" };
    case "out-of-usage":
      return { kind: "out-of-usage", resetsAt: check.resetsAt };
    case "signed-out":
    case "unknown":
      return { kind: "could-not-connect" };
  }
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

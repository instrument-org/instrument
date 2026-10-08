import { openPlanSheet, trialPlanAtom } from "@/client/atoms/plan-sheet";
import { useBillingStatus } from "@/client/hooks/use-billing-status";
import { HourglassMediumIcon } from "@phosphor-icons/react/HourglassMedium";
import { useAtomValue } from "jotai";

import { useNow } from "./use-now";

const DAY_MS = 86_400_000;

/**
 * The free trial counting down at the window's top right, while one is
 * running. Pressing it opens the plans, leading with the one picked when the
 * trial started.
 */
export function TrialBadge() {
  const { data: status } = useBillingStatus();
  const trialPlan = useAtomValue(trialPlanAtom);
  const now = useNow();
  if (status?.plan !== "trial" || status.trial.state !== "active") {
    return null;
  }
  const endsAt = status.trial.endsAt ? Date.parse(status.trial.endsAt) : NaN;
  const days = Number.isNaN(endsAt)
    ? undefined
    : Math.max(1, Math.ceil((endsAt - now.getTime()) / DAY_MS));

  return (
    <button
      className="flex h-7 items-center gap-1.5 rounded-full bg-card px-2.5 text-xs font-medium text-brand-700 shadow-xs ring-1 ring-brand-600/25 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-950/40"
      data-trial-badge
      onClick={() => {
        openPlanSheet(trialPlan ? { preselect: trialPlan } : {});
      }}
      type="button"
    >
      <HourglassMediumIcon className="size-3.5" />
      {days === undefined
        ? "Free trial"
        : `Free trial · ${days} ${days === 1 ? "day" : "days"} left`}
    </button>
  );
}

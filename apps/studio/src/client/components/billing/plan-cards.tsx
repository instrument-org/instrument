import { Button } from "@/client/components/ui/button";
import {
  allowanceLabel,
  formatAmount,
  planCardAction,
  type PlanCardAction,
} from "@/client/lib/billing";
import { cn } from "@/client/lib/utils";
import { type RPCOutput } from "@/client/rpc/client";

type Offer = RPCOutput["billing"]["offer"];
type OfferPlan = Offer["plans"][number];
type Status = RPCOutput["billing"]["status"];

/**
 * The plan picker: one card per plan the offer lists, however many that is,
 * side by side and wrapping. Each card's button says what it does for this
 * account (Subscribe, Switch to, Start free trial); the plan they are on is
 * marked instead. One card leads with the brand button so the choice has an
 * obvious default: the preselected plan, else the first one they could take.
 *
 * The same component is setup's plan step and the app's plan sheet.
 */
export function PlanCards({
  busyPlan,
  offer,
  onChoose,
  preselect,
  status,
  trial = false,
}: {
  /** The plan whose button is working (opening Checkout, switching). */
  busyPlan?: null | string;
  offer: Offer;
  onChoose: (plan: OfferPlan, action: PlanCardAction) => void;
  preselect?: string;
  status: Status | undefined;
  /** Setup's trial step: every card starts the trial instead of subscribing. */
  trial?: boolean;
}) {
  const actions = offer.plans.map((plan) => ({
    action: planCardAction(plan, status, { trial }),
    plan,
  }));
  const leading =
    actions.find(
      ({ action, plan }) => plan.key === preselect && action !== "current",
    ) ?? actions.find(({ action }) => action !== "current");

  return (
    <div className="flex flex-wrap justify-center gap-5" data-plan-cards>
      {actions.map(({ action, plan }) => (
        <PlanCard
          action={action}
          isBusy={busyPlan === plan.key}
          isLeading={leading?.plan.key === plan.key}
          key={plan.key}
          onChoose={() => {
            onChoose(plan, action);
          }}
          plan={plan}
        />
      ))}
    </div>
  );
}

function PlanCard({
  action,
  isBusy,
  isLeading,
  onChoose,
  plan,
}: {
  action: PlanCardAction;
  isBusy: boolean;
  isLeading: boolean;
  onChoose: () => void;
  plan: OfferPlan;
}) {
  const amount = formatAmount(plan.price);
  const label = {
    current: "",
    subscribe: amount ? `Subscribe for ${amount}` : "Subscribe",
    switch: `Switch to ${plan.name}`,
    trial: "Start free trial",
  }[action];

  return (
    <div
      className={cn(
        "flex w-70 flex-col rounded-[22px] bg-card p-6 text-card-foreground shadow-[0_10px_30px_-16px_rgba(28,25,23,0.35)] ring-1",
        action === "current"
          ? "ring-2 ring-brand-500"
          : "ring-black/7 dark:ring-white/10",
      )}
      data-plan-card={plan.key}
    >
      <div className="flex items-center gap-2 text-[15px] font-semibold">
        <span className="min-w-0 flex-1 truncate">{plan.name}</span>
        {action === "current" && (
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 dark:bg-brand-900 dark:text-brand-200">
            Your plan
          </span>
        )}
      </div>
      {amount && (
        <div className="mt-1.5 flex items-baseline gap-1">
          <span className="text-4xl font-semibold tracking-tight">
            {amount}
          </span>
          {plan.price?.interval && (
            <span className="text-sm text-muted-foreground">
              / {plan.price.interval}
            </span>
          )}
        </div>
      )}
      <div className="mt-4 flex items-center justify-between rounded-xl bg-muted px-3.5 py-2.5 text-[13px]">
        <span className="text-muted-foreground">AI usage</span>
        <span className="font-semibold">{allowanceLabel(plan)}</span>
      </div>
      {action !== "current" && (
        <Button
          className="mt-5 w-full rounded-full"
          disabled={isBusy}
          onClick={onChoose}
          variant={isLeading ? "brand" : "default"}
        >
          {label}
        </Button>
      )}
    </div>
  );
}

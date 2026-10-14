import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
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
 * The cards share a row and stack when it is too narrow for them.
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
    <div className="flex flex-wrap gap-3" data-plan-cards>
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
    <Card
      className={cn(
        "min-w-52 flex-1 basis-0 gap-0 border p-4",
        action === "current" && "border-brand-500/60",
      )}
      data-plan-card={plan.key}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {plan.name}
        </span>
        {action === "current" && <Badge variant="outline">Your plan</Badge>}
      </div>
      {amount && (
        <div className="mt-1 flex items-baseline gap-1">
          <span className="text-2xl font-semibold tracking-tight">
            {amount}
          </span>
          {plan.price?.interval && (
            <span className="text-xs text-muted-foreground">
              / {plan.price.interval}
            </span>
          )}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">AI usage</span>
        <span className="font-medium">{allowanceLabel(plan)}</span>
      </div>
      {action !== "current" && (
        <Button
          className="mt-4 w-full"
          disabled={isBusy}
          onClick={onChoose}
          size="sm"
          variant={isLeading ? "brand" : "default"}
        >
          {label}
        </Button>
      )}
    </Card>
  );
}
